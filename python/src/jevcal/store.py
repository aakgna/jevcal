from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from .types import DecisionResult, LoggedDecisionRecord, OutcomeLabel

logger = logging.getLogger("jevcal")


class JsonlStore:
    """Zero-dependency append-only JSONL store. Decisions and outcomes are
    written as separate lines and joined by requestId only at read time in
    get_records() — this avoids read-modify-write races when outcomes arrive
    concurrently, while the file stays trivially `jq`-able. Same on-disk shape
    as @jevcal/core's JsonlStore (TypeScript) — either language can read data
    logged by the other.
    """

    def __init__(self, file_path: str = ".jevcal/decisions.jsonl") -> None:
        self.file_path = Path(file_path)

    def log_decision(self, result: DecisionResult, input: Any) -> None:
        self._append_line({"kind": "decision", "result": result.model_dump(by_alias=True, mode="json"), "input": input})

    def attach_outcome(self, request_id: str, outcome: OutcomeLabel) -> None:
        self._append_line(
            {
                "kind": "outcome",
                "requestId": request_id,
                "outcome": outcome.model_dump(by_alias=True, mode="json"),
            }
        )

    def get_records(
        self, decision_name: str | None = None, since: str | None = None
    ) -> list[LoggedDecisionRecord]:
        records: dict[str, dict[str, Any]] = {}

        for line in self._read_lines():
            if line["kind"] == "decision":
                result = line["result"]
                request_id = result["requestId"]
                existing_outcomes = records.get(request_id, {}).get("outcomes", {})
                records[request_id] = {
                    "requestId": request_id,
                    "decisionName": result["decisionName"],
                    "schemaVersion": result["schemaVersion"],
                    "backendId": result["backendId"],
                    "model": result.get("model"),
                    "timestamp": result["timestamp"],
                    "input": line.get("input"),
                    "fields": result["fields"],
                    "outcomes": existing_outcomes,
                }
            else:
                request_id = line["requestId"]
                outcome = line["outcome"]
                if request_id in records:
                    records[request_id]["outcomes"][outcome["field"]] = outcome
                else:
                    # Outcome arrived before (or without) its decision line — keep it
                    # under a placeholder so attach_outcome() never silently drops data.
                    records[request_id] = {
                        "requestId": request_id,
                        "decisionName": "",
                        "schemaVersion": "",
                        "backendId": "",
                        "model": None,
                        "timestamp": "",
                        "input": None,
                        "fields": {},
                        "outcomes": {outcome["field"]: outcome},
                    }

        results = [LoggedDecisionRecord.model_validate(r) for r in records.values()]
        if decision_name is not None:
            results = [r for r in results if r.decision_name == decision_name]
        if since is not None:
            results = [r for r in results if r.timestamp >= since]
        return results

    def _append_line(self, line: dict[str, Any]) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        with self.file_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")

    def _read_lines(self) -> list[dict[str, Any]]:
        if not self.file_path.exists():
            return []
        lines: list[dict[str, Any]] = []
        with self.file_path.open("r", encoding="utf-8") as f:
            for line_number, raw_line in enumerate(f, start=1):
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    lines.append(json.loads(raw_line))
                except json.JSONDecodeError:
                    # A single truncated/corrupted line (e.g. from a crash
                    # mid-write) must not take down every future read of the
                    # rest of the file — skip it and keep going.
                    logger.warning(
                        "Skipping malformed JSONL line %d in %s (not valid JSON).",
                        line_number,
                        self.file_path,
                    )
        return lines
