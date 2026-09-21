from pydantic import BaseModel, Field

from jevcal import define_decision


class LoanFields(BaseModel):
    approved: bool = Field(description="Whether the loan should be approved")
    risk_tier: str = Field(description="Risk classification: low, medium, or high")


def test_define_decision_defaults_to_self_reported_confidence():
    decision = define_decision(name="loan-approval", fields=LoanFields)
    assert decision.confidence_strategy == "self-reported"
    assert decision.field_names == ["approved", "risk_tier"]


def test_self_reported_wire_model_gains_confidence_companion_fields():
    decision = define_decision(name="loan-approval", fields=LoanFields)
    wire_fields = set(decision.wire_model.model_fields.keys())
    assert wire_fields == {"approved", "risk_tier", "approved_confidence", "risk_tier_confidence"}


def test_values_model_is_unaugmented():
    decision = define_decision(name="loan-approval", fields=LoanFields)
    assert decision.values_model is LoanFields
    assert set(decision.values_model.model_fields.keys()) == {"approved", "risk_tier"}


def test_none_confidence_strategy_leaves_wire_model_unaugmented():
    decision = define_decision(name="loan-approval", fields=LoanFields, confidence="none")
    assert decision.wire_model is LoanFields
