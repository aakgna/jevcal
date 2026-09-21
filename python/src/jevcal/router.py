from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable
from uuid import uuid4

from .schema import DecisionSchema, confidence_field_key
from .types import (
    ConfidenceSignal,
    DecisionInput,
    DecisionResult,
    FieldPrediction,
    NoneSignal,
    RawBackendResponse,
    SelfReportedSignal,
)

logger = logging.getLogger("jevcal")

_warned_no_confidence = False


def normalize_confidence(signal: ConfidenceSignal) -> float | None:
    """Converts a backend-native confidence signal into a normalized 0-1
    probability. Deliberately conservative: a "none" signal normalizes to
    None, never a fabricated 1.0 — inventing confidence would poison the
    calibration metrics that are the point of this library."""
    if signal.kind == "logprob":
        # Geometric-mean-per-token approximation of the field's probability. A
        # heuristic, not exact — this is why "self-reported" is the default
        # confidence strategy and "logprob" is opt-in.
        return math.exp(signal.avg_logprob)
    if signal.kind == "self-reported":
        return signal.score
    if signal.kind == "native":
        return signal.probability
    return None


def extract_self_reported(
    decision: DecisionSchema, parsed_values: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, ConfidenceSignal]]:
    """Splits a backend's flat JSON response into clean field values and
    self-reported confidence signals, using the `${field}_confidence`
    companion-key convention that `define_decision` writes into the wire
    schema when confidence is "self-reported"."""
    values: dict[str, Any] = {}
    confidence_signals: dict[str, ConfidenceSignal] = {}
    for field_name in decision.field_names:
        values[field_name] = parsed_values.get(field_name)
        raw_score = parsed_values.get(confidence_field_key(field_name))
        confidence_signals[field_name] = (
            SelfReportedSignal(score=raw_score) if isinstance(raw_score, (int, float)) else NoneSignal()
        )
    return values, confidence_signals


def build_field_predictions(decision: DecisionSchema, raw: RawBackendResponse) -> dict[str, FieldPrediction]:
    global _warned_no_confidence

    parsed = decision.values_model.model_validate(raw.values)
    parsed_dict = parsed.model_dump()

    fields: dict[str, FieldPrediction] = {}
    for field_name in decision.field_names:
        signal = raw.confidence_signals.get(field_name, NoneSignal())
        probability = normalize_confidence(signal)

        if probability is None and not _warned_no_confidence:
            _warned_no_confidence = True
            logger.warning(
                'No confidence signal for field "%s" (decision "%s") — probability recorded as None and '
                "excluded from calibration metrics. This warning logs once per process.",
                field_name,
                decision.name,
            )

        fields[field_name] = FieldPrediction(value=parsed_dict[field_name], probability=probability, raw=signal)

    return fields


@runtime_checkable
class BackendAdapter(Protocol):
    id: str
    capabilities: dict[str, bool]

    def decide(self, decision: DecisionSchema, input: DecisionInput) -> RawBackendResponse: ...


class DecisionRouter:
    def __init__(self, backend: BackendAdapter, store: Any | None = None) -> None:
        self.backend = backend
        self.store = store

    def decide(self, decision: DecisionSchema, input: DecisionInput) -> DecisionResult:
        raw = self.backend.decide(decision, input)
        fields = build_field_predictions(decision, raw)

        result = DecisionResult(
            request_id=str(uuid4()),
            decision_name=decision.name,
            schema_version=decision.version,
            backend_id=self.backend.id,
            model=raw.model,
            timestamp=datetime.now(timezone.utc).isoformat(),
            fields=fields,
            raw=raw.raw,
        )

        if self.store is not None:
            self.store.log_decision(result, input.model_dump(by_alias=True, mode="json"))

        return result
