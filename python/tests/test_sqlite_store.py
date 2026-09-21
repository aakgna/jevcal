from concurrent.futures import ThreadPoolExecutor

from jevcal import DecisionResult, FieldPrediction, OutcomeLabel, SelfReportedSignal
from jevcal.sqlite_store import SqliteStore


def _make_result(request_id: str) -> DecisionResult:
    return DecisionResult(
        request_id=request_id,
        decision_name="loan-approval",
        schema_version="1",
        backend_id="test",
        model="test-model",
        timestamp="2026-09-19T00:00:00Z",
        fields={"approved": FieldPrediction(value=True, probability=0.9, raw=SelfReportedSignal(score=0.9))},
        raw={"usage": {"prompt_tokens": 10}},
    )


def test_log_and_retrieve_round_trip(tmp_path):
    store = SqliteStore(str(tmp_path / "decisions.sqlite"))
    store.log_decision(_make_result("req-1"), input={"input": "some applicant"})
    store.attach_outcome("req-1", OutcomeLabel(field="approved", actual_value=True, observed_at="2026-09-20T00:00:00Z"))

    records = store.get_records(decision_name="loan-approval")
    assert len(records) == 1
    record = records[0]
    assert record.request_id == "req-1"
    assert record.fields["approved"].value is True
    assert record.fields["approved"].probability == 0.9
    assert record.outcomes["approved"].actual_value is True


def test_filters_by_decision_name(tmp_path):
    store = SqliteStore(str(tmp_path / "decisions.sqlite"))
    store.log_decision(_make_result("req-1"), input={"input": "x"})
    other = _make_result("req-2")
    other = other.model_copy(update={"decision_name": "other-decision"})
    store.log_decision(other, input={"input": "y"})

    assert len(store.get_records(decision_name="loan-approval")) == 1
    assert len(store.get_records(decision_name="other-decision")) == 1
    assert len(store.get_records()) == 2


def test_same_records_same_calibration_math_as_jsonl_store(tmp_path):
    """The whole point of a swappable DecisionStore: get_calibration() must not care which one backs it."""
    from jevcal import JsonlStore, get_calibration

    sqlite_store = SqliteStore(str(tmp_path / "decisions.sqlite"))
    jsonl_store = JsonlStore(str(tmp_path / "decisions.jsonl"))

    for i, correct in enumerate([True, True, False, True]):
        result = _make_result(f"req-{i}")
        for store in (sqlite_store, jsonl_store):
            store.log_decision(result, input={"input": "x"})
            store.attach_outcome(
                result.request_id,
                OutcomeLabel(field="approved", actual_value=correct, observed_at="2026-09-20T00:00:00Z"),
            )

    sqlite_report = get_calibration(sqlite_store, decision_name="loan-approval", field="approved")
    jsonl_report = get_calibration(jsonl_store, decision_name="loan-approval", field="approved")

    assert sqlite_report.n == jsonl_report.n == 4
    assert sqlite_report.ece == jsonl_report.ece
    assert sqlite_report.brier == jsonl_report.brier


def test_concurrent_writes_from_many_threads_lose_nothing(tmp_path):
    """Exercises the check_same_thread=False + WAL + busy_timeout + Lock fix
    directly: before that fix, this test would fail immediately with
    'SQLite objects created in a thread can only be used in that same thread'."""
    store = SqliteStore(str(tmp_path / "decisions.sqlite"))
    n = 200

    def write_one(i: int) -> None:
        result = _make_result(f"req-{i}")
        store.log_decision(result, input={"input": f"case {i}"})
        store.attach_outcome(
            result.request_id,
            OutcomeLabel(field="approved", actual_value=(i % 2 == 0), observed_at="2026-09-21T00:00:00Z"),
        )

    with ThreadPoolExecutor(max_workers=25) as pool:
        list(pool.map(write_one, range(n)))

    records = store.get_records(decision_name="loan-approval")
    assert len(records) == n, "no writes should be lost under concurrent threaded access"
    assert len({r.request_id for r in records}) == n, "no duplicate/corrupted request_ids"
    assert all("approved" in r.outcomes for r in records), "every record's outcome must have landed correctly"
