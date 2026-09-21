from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .types import DecisionResult, FieldPrediction, LoggedDecisionRecord, OutcomeLabel

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
  request_id TEXT PRIMARY KEY,
  decision_name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  backend_id TEXT NOT NULL,
  model TEXT,
  timestamp TEXT NOT NULL,
  input TEXT,
  fields TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outcomes (
  request_id TEXT NOT NULL,
  field TEXT NOT NULL,
  actual_value TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  metadata TEXT,
  PRIMARY KEY (request_id, field)
);
"""


class SqliteStore:
    """Local store backed by SQLite (Python's stdlib `sqlite3` — no optional
    dependency needed, unlike the TypeScript SDK which needs `better-sqlite3`
    since Node has no built-in SQLite). Useful once a JSONL file grows past
    comfortable full-scan size, or under real concurrent-write load where
    SQLite's own locking is meaningfully safer than raw file appends. Same
    `log_decision`/`attach_outcome`/`get_records` shape as `JsonlStore` — a
    drop-in swap."""

    def __init__(self, file_path: str = ".jevcal/decisions.sqlite") -> None:
        self.file_path = Path(file_path)
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: this connection is shared across threads by
        # design (e.g. a ThreadPoolExecutor of workers logging concurrently) —
        # safe because writes go through self._lock below, and SQLite itself
        # (compiled in serialized threading mode, the default) tolerates
        # concurrent use of one connection from multiple threads.
        self._conn = sqlite3.connect(str(self.file_path), check_same_thread=False)
        # WAL: readers no longer block on a writer (and vice versa) — the
        # standard fix for concurrent SQLite access, matters across both
        # threads sharing this connection and separate processes sharing this
        # file. busy_timeout: a writer that finds the database locked waits
        # and retries for up to 5s instead of raising immediately.
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()
        # Belt-and-suspenders on top of WAL/busy_timeout: serializes writes
        # from this process's threads at the Python level too, so two threads
        # can never interleave statements within a single logical write.
        self._write_lock = threading.Lock()

    def log_decision(self, result: DecisionResult, input: Any) -> None:
        with self._write_lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO decisions (request_id, decision_name, schema_version, backend_id, model, "
                "timestamp, input, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    result.request_id,
                    result.decision_name,
                    result.schema_version,
                    result.backend_id,
                    result.model,
                    result.timestamp,
                    json.dumps(input),
                    json.dumps({k: v.model_dump(by_alias=True, mode="json") for k, v in result.fields.items()}),
                ),
            )
            self._conn.commit()

    def attach_outcome(self, request_id: str, outcome: OutcomeLabel) -> None:
        with self._write_lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO outcomes (request_id, field, actual_value, observed_at, metadata) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    request_id,
                    outcome.field,
                    json.dumps(outcome.actual_value),
                    outcome.observed_at,
                    json.dumps(outcome.metadata) if outcome.metadata is not None else None,
                ),
            )
            self._conn.commit()

    def get_records(
        self, decision_name: str | None = None, since: str | None = None
    ) -> list[LoggedDecisionRecord]:
        sql = "SELECT request_id, decision_name, schema_version, backend_id, model, timestamp, input, fields FROM decisions"
        conditions: list[str] = []
        params: list[str] = []
        if decision_name is not None:
            conditions.append("decision_name = ?")
            params.append(decision_name)
        if since is not None:
            conditions.append("timestamp >= ?")
            params.append(since)
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)

        rows = self._conn.execute(sql, params).fetchall()
        results: list[LoggedDecisionRecord] = []
        for row in rows:
            request_id, dec_name, schema_version, backend_id, model, timestamp, input_json, fields_json = row
            outcome_rows = self._conn.execute(
                "SELECT field, actual_value, observed_at, metadata FROM outcomes WHERE request_id = ?",
                (request_id,),
            ).fetchall()
            outcomes = {
                field: OutcomeLabel(
                    field=field,
                    actual_value=json.loads(actual_value),
                    observed_at=observed_at,
                    metadata=json.loads(metadata) if metadata is not None else None,
                )
                for field, actual_value, observed_at, metadata in outcome_rows
            }
            fields = {k: FieldPrediction.model_validate(v) for k, v in json.loads(fields_json).items()}
            results.append(
                LoggedDecisionRecord(
                    request_id=request_id,
                    decision_name=dec_name,
                    schema_version=schema_version,
                    backend_id=backend_id,
                    model=model,
                    timestamp=timestamp,
                    input=json.loads(input_json) if input_json is not None else None,
                    fields=fields,
                    outcomes=outcomes,
                )
            )
        return results

    def close(self) -> None:
        self._conn.close()
