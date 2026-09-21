from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

ConfidenceStrategy = Literal["self-reported", "logprob", "none"]


class WireModel(BaseModel):
    """Base for anything written to the shared JSONL wire format — aliases
    fields to camelCase so Python and the TypeScript SDK read/write the exact
    same on-disk shape (`requestId`, not `request_id`), and either language's
    `jevcal` CLI can read data logged by the other."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class LogprobSignal(WireModel):
    kind: Literal["logprob"] = "logprob"
    avg_logprob: float
    token_count: int


class SelfReportedSignal(WireModel):
    kind: Literal["self-reported"] = "self-reported"
    score: float


class NativeSignal(WireModel):
    """First-class probability computed by the backend itself, not derived or elicited."""

    kind: Literal["native"] = "native"
    probability: float
    distribution: dict[str, float] | None = None


class NoneSignal(WireModel):
    kind: Literal["none"] = "none"


# Invariant every adapter must uphold: the numeric confidence on
# self-reported/native signals (and the value derived from avg_logprob)
# always means confidence that the PREDICTED value is correct — never a raw,
# direction-specific probability like "P(this field is true)". For a boolean
# field those are only the same number when the predicted value is True;
# when a model confidently predicts False, a raw P(true) would be *low* even
# though the model is highly confident. If your backend's native signal is
# direction-specific (e.g. Jev's `noul`, literally P(statement is true)),
# flip it at the adapter boundary — p if the predicted value is True, 1 - p
# if False — before constructing this signal. Getting this wrong doesn't
# crash anything; it silently produces a calibration report that looks
# catastrophically miscalibrated for a model that's actually fine, which is
# worse than crashing. (See adapters/jev.py for the reference fix.)
ConfidenceSignal = Union[LogprobSignal, SelfReportedSignal, NativeSignal, NoneSignal]


class FieldPrediction(WireModel):
    value: Any
    # Normalized 0-1 confidence that `value` is correct, or None if the backend reported no usable confidence signal.
    probability: float | None
    raw: ConfidenceSignal | None = Field(default=None, discriminator="kind")


class DecisionInput(WireModel):
    input: Union[str, list[dict[str, str]]]
    metadata: dict[str, Any] | None = None


class RawBackendResponse(BaseModel):
    """What a BackendAdapter hands back to the router — not itself part of the
    wire format (no camelCase aliasing needed); the router turns this into a
    DecisionResult, which is."""

    values: dict[str, Any]
    confidence_signals: dict[str, ConfidenceSignal]
    model: str | None = None
    raw: Any = None


class DecisionResult(WireModel):
    request_id: str
    decision_name: str
    schema_version: str
    backend_id: str
    model: str | None = None
    timestamp: str
    fields: dict[str, FieldPrediction]
    raw: Any = None


class OutcomeLabel(WireModel):
    field: str
    actual_value: Any
    observed_at: str
    metadata: dict[str, Any] | None = None


class LoggedDecisionRecord(WireModel):
    request_id: str
    decision_name: str
    schema_version: str
    backend_id: str
    model: str | None = None
    timestamp: str
    input: Any | None = None
    fields: dict[str, FieldPrediction]
    outcomes: dict[str, OutcomeLabel] = Field(default_factory=dict)


class CalibrationSample(BaseModel):
    predicted_probability: float
    correct: bool


class ReliabilityBin(BaseModel):
    bin_start: float
    bin_end: float
    avg_predicted_probability: float
    observed_frequency: float
    sample_count: int
