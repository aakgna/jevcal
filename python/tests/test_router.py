import logging

import pytest
from pydantic import BaseModel, Field

import jevcal.router as router_module
from jevcal import (
    DecisionInput,
    DecisionRouter,
    JsonlStore,
    NativeSignal,
    NoneSignal,
    RawBackendResponse,
    SelfReportedSignal,
    build_field_predictions,
    define_decision,
    extract_self_reported,
    normalize_confidence,
)


class LoanFields(BaseModel):
    approved: bool = Field(description="Whether the loan should be approved")
    risk_tier: str = Field(description="Risk classification")


def test_normalize_confidence_self_reported():
    assert normalize_confidence(SelfReportedSignal(score=0.75)) == 0.75


def test_normalize_confidence_native():
    assert normalize_confidence(NativeSignal(probability=0.6)) == 0.6


def test_normalize_confidence_logprob_uses_exp():
    import math

    from jevcal.types import LogprobSignal

    result = normalize_confidence(LogprobSignal(avg_logprob=-0.1, token_count=3))
    assert result == pytest.approx(math.exp(-0.1))


def test_normalize_confidence_none_is_none_not_fabricated():
    assert normalize_confidence(NoneSignal()) is None


def test_extract_self_reported_splits_companion_fields():
    decision = define_decision(name="loan", fields=LoanFields)
    parsed = {"approved": True, "approved_confidence": 0.9, "risk_tier": "low", "risk_tier_confidence": 0.8}
    values, signals = extract_self_reported(decision, parsed)
    assert values == {"approved": True, "risk_tier": "low"}
    assert signals["approved"] == SelfReportedSignal(score=0.9)
    assert signals["risk_tier"] == SelfReportedSignal(score=0.8)


def test_extract_self_reported_missing_confidence_is_none_signal():
    decision = define_decision(name="loan", fields=LoanFields)
    values, signals = extract_self_reported(decision, {"approved": True, "risk_tier": "low"})
    assert signals["approved"] == NoneSignal()


def test_build_field_predictions_normalizes_and_validates():
    decision = define_decision(name="loan", fields=LoanFields)
    raw = RawBackendResponse(
        values={"approved": True, "risk_tier": "low"},
        confidence_signals={"approved": NativeSignal(probability=0.9), "risk_tier": NativeSignal(probability=0.8)},
    )
    fields = build_field_predictions(decision, raw)
    assert fields["approved"].value is True
    assert fields["approved"].probability == 0.9
    assert fields["risk_tier"].probability == 0.8


def test_build_field_predictions_warns_once_on_missing_confidence(caplog):
    router_module._warned_no_confidence = False  # reset module-level once-flag for this test
    decision = define_decision(name="loan", fields=LoanFields)
    raw = RawBackendResponse(
        values={"approved": True, "risk_tier": "low"},
        confidence_signals={"approved": NoneSignal(), "risk_tier": NoneSignal()},
    )
    with caplog.at_level(logging.WARNING, logger="jevcal"):
        fields = build_field_predictions(decision, raw)
    assert fields["approved"].probability is None
    assert sum("No confidence signal" in r.message for r in caplog.records) == 1  # only once, not per field


class FakeAdapter:
    id = "fake"
    capabilities = {"logprobs": False}

    def __init__(self, response: RawBackendResponse):
        self.response = response
        self.calls: list = []

    def decide(self, decision, input):
        self.calls.append((decision, input))
        return self.response


def test_decision_router_decide_generates_request_id_and_logs(tmp_path):
    decision = define_decision(name="loan", fields=LoanFields)
    backend = FakeAdapter(
        RawBackendResponse(
            values={"approved": True, "risk_tier": "low"},
            confidence_signals={"approved": NativeSignal(probability=0.9), "risk_tier": NativeSignal(probability=0.8)},
            model="fake-model",
            raw={"ok": True},
        )
    )
    store = JsonlStore(str(tmp_path / "decisions.jsonl"))
    router = DecisionRouter(backend=backend, store=store)

    result = router.decide(decision, DecisionInput(input="applicant description"))

    assert result.request_id
    assert result.backend_id == "fake"
    assert result.model == "fake-model"
    assert result.fields["approved"].value is True

    records = store.get_records(decision_name="loan")
    assert len(records) == 1
    assert records[0].request_id == result.request_id


def test_decision_router_without_store_does_not_error():
    decision = define_decision(name="loan", fields=LoanFields)
    backend = FakeAdapter(
        RawBackendResponse(values={"approved": False, "risk_tier": "high"}, confidence_signals={})
    )
    router = DecisionRouter(backend=backend, store=None)
    result = router.decide(decision, DecisionInput(input="x"))
    assert result.fields["approved"].value is False
    assert result.fields["approved"].probability is None
