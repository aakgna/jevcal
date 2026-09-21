import os
from concurrent.futures import ThreadPoolExecutor

import pytest

psycopg = pytest.importorskip("psycopg")

from jevcal import DecisionResult, FieldPrediction, OutcomeLabel, SelfReportedSignal, get_calibration  # noqa: E402
from jevcal.postgres_store import PostgresStore  # noqa: E402

# Defaults to the local dev database (Homebrew Postgres, peer auth via Unix
# socket). CI overrides this to point at a Docker service container instead
# (TCP + password auth) via JEVCAL_TEST_POSTGRES_DSN.
CONNINFO = os.environ.get("JEVCAL_TEST_POSTGRES_DSN", "dbname=jevcal_stress_test")


@pytest.fixture
def store():
    try:
        s = PostgresStore(CONNINFO)
    except psycopg.OperationalError:
        pytest.skip("jevcal_stress_test Postgres database not reachable")
    with s._pool.connection() as conn:
        conn.execute("DELETE FROM decisions; DELETE FROM outcomes;")
        conn.commit()
    yield s
    with s._pool.connection() as conn:
        conn.execute("DELETE FROM decisions; DELETE FROM outcomes;")
        conn.commit()
    s.close()


def _make_result(request_id: str) -> DecisionResult:
    return DecisionResult(
        request_id=request_id,
        decision_name="loan-approval",
        schema_version="1",
        backend_id="test",
        model="test-model",
        timestamp="2026-09-21T00:00:00Z",
        fields={"approved": FieldPrediction(value=True, probability=0.9, raw=SelfReportedSignal(score=0.9))},
        raw={"usage": {"prompt_tokens": 10}},
    )


def test_log_and_retrieve_round_trip(store):
    store.log_decision(_make_result("req-1"), input={"input": "some applicant"})
    store.attach_outcome("req-1", OutcomeLabel(field="approved", actual_value=True, observed_at="2026-09-21T00:00:01Z"))

    records = store.get_records(decision_name="loan-approval")
    assert len(records) == 1
    assert records[0].fields["approved"].value is True
    assert records[0].outcomes["approved"].actual_value is True


def test_filters_by_decision_name(store):
    store.log_decision(_make_result("req-1"), input={"input": "x"})
    other = _make_result("req-2").model_copy(update={"decision_name": "other-decision"})
    store.log_decision(other, input={"input": "y"})

    assert len(store.get_records(decision_name="loan-approval")) == 1
    assert len(store.get_records(decision_name="other-decision")) == 1
    assert len(store.get_records()) == 2


def test_same_records_same_calibration_math_as_other_stores(store, tmp_path):
    from jevcal import JsonlStore
    from jevcal.sqlite_store import SqliteStore

    jsonl_store = JsonlStore(str(tmp_path / "decisions.jsonl"))
    sqlite_store = SqliteStore(str(tmp_path / "decisions.sqlite"))

    for i, correct in enumerate([True, True, False, True]):
        result = _make_result(f"req-{i}")
        for s in (store, jsonl_store, sqlite_store):
            s.log_decision(result, input={"input": "x"})
            s.attach_outcome(
                result.request_id,
                OutcomeLabel(field="approved", actual_value=correct, observed_at="2026-09-21T00:00:00Z"),
            )

    pg_report = get_calibration(store, decision_name="loan-approval", field="approved")
    jsonl_report = get_calibration(jsonl_store, decision_name="loan-approval", field="approved")
    sqlite_report = get_calibration(sqlite_store, decision_name="loan-approval", field="approved")

    assert pg_report.n == jsonl_report.n == sqlite_report.n == 4
    assert pg_report.ece == jsonl_report.ece == sqlite_report.ece
    assert pg_report.brier == jsonl_report.brier == sqlite_report.brier


def test_concurrent_writes_from_many_threads_lose_nothing(store):
    """The connection-pool equivalent of the SqliteStore threading test —
    each thread's write checks out its own pooled connection."""
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
    assert len(records) == n
    assert len({r.request_id for r in records}) == n
    assert all("approved" in r.outcomes for r in records)
