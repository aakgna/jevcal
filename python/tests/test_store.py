import json

from jevcal import DecisionResult, FieldPrediction, JsonlStore, OutcomeLabel, SelfReportedSignal


def _make_result(request_id: str) -> DecisionResult:
    return DecisionResult(
        request_id=request_id,
        decision_name="loan-approval",
        schema_version="1",
        backend_id="test",
        model="test-model",
        timestamp="2026-09-19T00:00:00Z",
        fields={
            "approved": FieldPrediction(value=True, probability=0.9, raw=SelfReportedSignal(score=0.9)),
        },
        raw={"usage": {"prompt_tokens": 10}},
    )


def test_log_and_retrieve_round_trip(tmp_path):
    store = JsonlStore(str(tmp_path / "decisions.jsonl"))
    store.log_decision(_make_result("req-1"), input={"input": "some applicant"})
    store.attach_outcome("req-1", OutcomeLabel(field="approved", actual_value=True, observed_at="2026-09-20T00:00:00Z"))

    records = store.get_records(decision_name="loan-approval")
    assert len(records) == 1
    record = records[0]
    assert record.request_id == "req-1"
    assert record.fields["approved"].value is True
    assert record.fields["approved"].probability == 0.9
    assert record.outcomes["approved"].actual_value is True


def test_wire_format_uses_camel_case_keys(tmp_path):
    """The whole point of the shared format: a TS reader must see requestId, not request_id."""
    path = tmp_path / "decisions.jsonl"
    store = JsonlStore(str(path))
    store.log_decision(_make_result("req-1"), input={"input": "x"})

    line = json.loads(path.read_text().splitlines()[0])
    assert line["kind"] == "decision"
    assert "requestId" in line["result"]
    assert "decisionName" in line["result"]
    assert "request_id" not in line["result"]


def test_outcome_before_decision_is_not_dropped(tmp_path):
    store = JsonlStore(str(tmp_path / "decisions.jsonl"))
    store.attach_outcome("req-2", OutcomeLabel(field="approved", actual_value=False, observed_at="2026-09-20T00:00:00Z"))
    store.log_decision(_make_result("req-2"), input={"input": "y"})

    records = store.get_records()
    assert len(records) == 1
    assert records[0].outcomes["approved"].actual_value is False


def test_malformed_line_is_skipped_not_fatal(tmp_path, caplog):
    """A single truncated/corrupted line (e.g. a crash mid-write) must not
    take down every future read of the rest of the file."""
    import logging

    path = tmp_path / "decisions.jsonl"
    store = JsonlStore(str(path))
    store.log_decision(_make_result("req-1"), input={"input": "x"})

    with path.open("a", encoding="utf-8") as f:
        f.write('{"kind": "decision", "result": {truncated garbage\n')

    store.log_decision(_make_result("req-2"), input={"input": "y"})

    with caplog.at_level(logging.WARNING, logger="jevcal"):
        records = store.get_records()

    assert {r.request_id for r in records} == {"req-1", "req-2"}
    assert any("Skipping malformed JSONL line" in r.message for r in caplog.records)
