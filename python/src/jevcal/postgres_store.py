from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .types import DecisionResult, FieldPrediction, LoggedDecisionRecord, OutcomeLabel

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
  request_id TEXT PRIMARY KEY,
  decision_name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  backend_id TEXT NOT NULL,
  model TEXT,
  timestamp TEXT NOT NULL,
  input JSONB,
  fields JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS outcomes (
  request_id TEXT NOT NULL,
  field TEXT NOT NULL,
  actual_value JSONB NOT NULL,
  observed_at TEXT NOT NULL,
  metadata JSONB,
  PRIMARY KEY (request_id, field)
);
"""


class PostgresStore:
    """Store backed by a real PostgreSQL database via `psycopg` (requires the
    `jevcal[postgres]` extra — not a dependency of the core package, the same
    way `better-sqlite3` stays optional on the TypeScript side). Uses a real
    connection pool (`psycopg_pool.ConnectionPool`): every call checks out its
    own connection rather than sharing one across threads, which is what
    actually makes this safe under concurrent access — the same class of bug
    that had to be fixed in `SqliteStore` for a single shared connection.
    Same `log_decision`/`attach_outcome`/`get_records` shape as the other
    stores — another drop-in `DecisionStore`.
    """

    def __init__(self, conninfo: str, min_size: int = 2, max_size: int = 20) -> None:
        self._pool = ConnectionPool(conninfo, min_size=min_size, max_size=max_size, open=True)
        with self._pool.connection() as conn:
            conn.execute(_SCHEMA)
            conn.commit()

    def log_decision(self, result: DecisionResult, input: Any) -> None:
        fields_json = {k: v.model_dump(by_alias=True, mode="json") for k, v in result.fields.items()}
        with self._pool.connection() as conn:
            conn.execute(
                """
                INSERT INTO decisions (request_id, decision_name, schema_version, backend_id, model, timestamp, input, fields)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (request_id) DO UPDATE SET
                  decision_name = EXCLUDED.decision_name,
                  schema_version = EXCLUDED.schema_version,
                  backend_id = EXCLUDED.backend_id,
                  model = EXCLUDED.model,
                  timestamp = EXCLUDED.timestamp,
                  input = EXCLUDED.input,
                  fields = EXCLUDED.fields
                """,
                (
                    result.request_id,
                    result.decision_name,
                    result.schema_version,
                    result.backend_id,
                    result.model,
                    result.timestamp,
                    Jsonb(input),
                    Jsonb(fields_json),
                ),
            )
            conn.commit()

    def attach_outcome(self, request_id: str, outcome: OutcomeLabel) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                """
                INSERT INTO outcomes (request_id, field, actual_value, observed_at, metadata)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (request_id, field) DO UPDATE SET
                  actual_value = EXCLUDED.actual_value,
                  observed_at = EXCLUDED.observed_at,
                  metadata = EXCLUDED.metadata
                """,
                (
                    request_id,
                    outcome.field,
                    Jsonb(outcome.actual_value),
                    outcome.observed_at,
                    Jsonb(outcome.metadata) if outcome.metadata is not None else None,
                ),
            )
            conn.commit()

    def get_records(
        self, decision_name: str | None = None, since: str | None = None
    ) -> list[LoggedDecisionRecord]:
        sql = "SELECT request_id, decision_name, schema_version, backend_id, model, timestamp, input, fields FROM decisions"
        conditions: list[str] = []
        params: list[Any] = []
        if decision_name is not None:
            conditions.append("decision_name = %s")
            params.append(decision_name)
        if since is not None:
            conditions.append("timestamp >= %s")
            params.append(since)
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)

        with self._pool.connection() as conn:
            rows = conn.execute(sql, params).fetchall()
            results: list[LoggedDecisionRecord] = []
            for row in rows:
                request_id, dec_name, schema_version, backend_id, model, timestamp, input_json, fields_json = row
                outcome_rows = conn.execute(
                    "SELECT field, actual_value, observed_at, metadata FROM outcomes WHERE request_id = %s",
                    (request_id,),
                ).fetchall()
                outcomes = {
                    field: OutcomeLabel(field=field, actual_value=actual_value, observed_at=observed_at, metadata=metadata)
                    for field, actual_value, observed_at, metadata in outcome_rows
                }
                fields = {k: FieldPrediction.model_validate(v) for k, v in fields_json.items()}
                results.append(
                    LoggedDecisionRecord(
                        request_id=request_id,
                        decision_name=dec_name,
                        schema_version=schema_version,
                        backend_id=backend_id,
                        model=model,
                        timestamp=timestamp,
                        input=input_json,
                        fields=fields,
                        outcomes=outcomes,
                    )
                )
            return results

    def close(self) -> None:
        self._pool.close()
