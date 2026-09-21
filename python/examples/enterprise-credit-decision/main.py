"""Tests the real published package: `pip install -i https://test.pypi.org/simple/ jevcal`.

Unlike every prior example (2-3 fields), this schema is deliberately large and
enterprise-shaped: 20 fields spanning booleans, enums, floats, ints, and free
text — the kind of multi-signal underwriting decision a real credit system
would actually return, not a toy.

There's no Python backend adapter yet (v0.1 is core-only), so this simulates
what a real backend call would produce: a deterministic ground-truth rule
(independent of the "model"), a synthetic predictor whose errors concentrate
in borderline cases while its stated confidence stays flat and high — logged
through the real installed package, graded, and calibration-reported. Whether
that comes out over- or under-confident per field isn't scripted; the point is
that the pipeline surfaces whatever's actually there, at a schema size and
field-type variety no prior example in this project has tested.
"""

import random
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from jevcal import (
    DecisionResult,
    FieldPrediction,
    JsonlStore,
    OutcomeLabel,
    SelfReportedSignal,
    define_decision,
    get_calibration,
)


class EnterpriseCreditDecision(BaseModel):
    # --- core decision ---
    approved: bool = Field(description="Whether the credit application should be approved")
    risk_tier: Literal["low", "medium", "high", "severe"] = Field(description="Overall risk classification")
    recommended_credit_limit: float = Field(description="Recommended credit limit in USD")
    recommended_interest_rate_bps: int = Field(description="Recommended interest rate, in basis points")
    recommended_term_months: int = Field(description="Recommended loan term in months")
    suggested_product_type: Literal["standard", "secured", "subprime", "premium"] = Field(
        description="Which credit product this applicant should be offered"
    )

    # --- underwriting / compliance signals ---
    requires_manual_underwriter_review: bool = Field(description="Whether a human underwriter must review this before it's final")
    requires_additional_documentation: bool = Field(description="Whether additional documents are needed before deciding")
    kyc_status: Literal["verified", "pending", "failed", "not_applicable"] = Field(description="Know-your-customer verification status")
    aml_flag: bool = Field(description="Whether this application triggers an anti-money-laundering review")
    regulatory_hold: bool = Field(description="Whether this application must be held for regulatory reasons")
    income_verification_status: Literal["verified", "self_reported", "unverifiable"] = Field(
        description="How the applicant's stated income was verified"
    )

    # --- risk modeling detail ---
    fraud_risk_score: float = Field(description="Estimated fraud risk, 0-100")
    debt_service_coverage_ratio_estimate: float = Field(description="Estimated ratio of income available to cover debt service")
    collections_risk_tier: Literal["low", "medium", "high"] = Field(description="Likelihood this account eventually enters collections")
    credit_bureau_dispute_flag: bool = Field(description="Whether the applicant has an active credit bureau dispute on file")

    # --- structuring ---
    collateral_required: bool = Field(description="Whether collateral should be required for approval")
    co_signer_required: bool = Field(description="Whether a co-signer should be required for approval")
    escalation_tier: Literal["none", "tier1", "tier2", "executive"] = Field(
        description="Internal escalation tier this application should route to, if any"
    )
    decision_rationale: str = Field(description="One-sentence plain-language rationale for the decision")


decision = define_decision(name="enterprise-credit-decision", fields=EnterpriseCreditDecision)

print(f"Schema field count: {len(decision.field_names)}")
print(f"Wire model field count (with self-reported confidence companions): {len(decision.wire_model.model_fields)}")
assert len(decision.wire_model.model_fields) == len(decision.field_names) * 2, "confidence augmentation should double the field count"


# ---------------------------------------------------------------------------
# Simulated applications: a deterministic ground-truth rule, independent of
# the "model", with a deliberate mix of clear-cut and borderline cases.
# ---------------------------------------------------------------------------

rng = random.Random(7)


def generate_applicant(bucket: int) -> dict:
    if bucket == 0:  # clear approve
        credit_score = rng.randint(720, 820)
        dti = rng.uniform(0.10, 0.30)
        prior_defaults = 0
        fraud_score = rng.uniform(0, 15)
    elif bucket == 1:  # clear deny
        credit_score = rng.randint(500, 610)
        dti = rng.uniform(0.55, 0.75)
        prior_defaults = rng.randint(1, 3)
        fraud_score = rng.uniform(40, 90)
    else:  # borderline
        credit_score = rng.randint(650, 675)
        dti = rng.uniform(0.42, 0.48)
        prior_defaults = 0
        fraud_score = rng.uniform(20, 35)
    return {
        "credit_score": credit_score,
        "dti": dti,
        "prior_defaults": prior_defaults,
        "fraud_score": fraud_score,
        "income": rng.randint(35_000, 220_000),
    }


def ground_truth(app: dict) -> dict:
    approved = app["credit_score"] >= 660 and app["dti"] <= 0.45 and app["prior_defaults"] == 0
    aml_flag = app["fraud_score"] >= 50
    regulatory_hold = app["fraud_score"] >= 80
    manual_review = not approved or app["fraud_score"] >= 30
    return {
        "approved": approved,
        "aml_flag": aml_flag,
        "regulatory_hold": regulatory_hold,
        "requires_manual_underwriter_review": manual_review,
    }


def simulate_prediction(app: dict, truth: dict, bucket: int) -> dict:
    """A deliberately overconfident synthetic predictor: real classification
    errors concentrated in borderline cases (matching the pattern found in
    every earlier real test this session), while stated confidence stays high
    regardless — so the miscalibration comes from genuine mistakes the model
    is unjustifiably sure about, not just an arbitrary confidence offset."""
    error_rate = 0.32 if bucket == 2 else 0.04
    predicted_approved = truth["approved"] if rng.random() > error_rate else not truth["approved"]
    stated_confidence = rng.uniform(0.75, 0.93)
    risk_tier = "low" if app["fraud_score"] < 20 else "medium" if app["fraud_score"] < 50 else "high" if app["fraud_score"] < 80 else "severe"

    return {
        "approved": (predicted_approved, stated_confidence),
        "risk_tier": (risk_tier, 0.8),
        "recommended_credit_limit": (round(max(0, (app["credit_score"] - 600) * 40), -2), 0.7),
        "recommended_interest_rate_bps": (int(max(400, 2200 - app["credit_score"] * 2)), 0.7),
        "recommended_term_months": (36, 0.6),
        "suggested_product_type": ("premium" if app["credit_score"] > 750 else "standard" if app["credit_score"] > 660 else "subprime", 0.75),
        "requires_manual_underwriter_review": (truth["requires_manual_underwriter_review"], 0.65),
        "requires_additional_documentation": (app["fraud_score"] > 25, 0.6),
        "kyc_status": ("verified", 0.9),
        "aml_flag": (truth["aml_flag"], 0.7),
        "regulatory_hold": (truth["regulatory_hold"], 0.85),
        "income_verification_status": ("self_reported", 0.5),
        "fraud_risk_score": (round(app["fraud_score"], 1), 0.7),
        "debt_service_coverage_ratio_estimate": (round(1 / max(app["dti"], 0.01) * 0.3, 2), 0.6),
        "collections_risk_tier": ("low" if app["fraud_score"] < 30 else "medium" if app["fraud_score"] < 60 else "high", 0.65),
        "credit_bureau_dispute_flag": (False, 0.8),
        "collateral_required": (app["credit_score"] < 650, 0.6),
        "co_signer_required": (app["credit_score"] < 600, 0.6),
        "escalation_tier": ("executive" if app["fraud_score"] > 80 else "tier2" if app["fraud_score"] > 50 else "tier1" if app["fraud_score"] > 25 else "none", 0.55),
        "decision_rationale": (f"Credit score {app['credit_score']}, DTI {app['dti']:.2f}, fraud risk {app['fraud_score']:.0f}.", 0.5),
    }


store = JsonlStore(".jevcal/decisions.jsonl")
N = 300
correct_count = 0

for i in range(N):
    bucket = i % 3
    app = generate_applicant(bucket)
    truth = ground_truth(app)
    prediction = simulate_prediction(app, truth, bucket)

    fields = {
        field_name: FieldPrediction(value=value, probability=prob, raw=SelfReportedSignal(score=prob))
        for field_name, (value, prob) in prediction.items()
    }
    assert set(fields.keys()) == set(decision.field_names), "simulated prediction must cover every schema field"

    result = DecisionResult(
        request_id=str(uuid4()),
        decision_name=decision.name,
        schema_version=decision.version,
        backend_id="simulated",
        model="enterprise-test-simulator",
        timestamp=datetime.now(timezone.utc).isoformat(),
        fields=fields,
    )
    store.log_decision(result, input={"input": f"applicant #{i}"})

    for field_name in ("approved", "aml_flag", "regulatory_hold", "requires_manual_underwriter_review"):
        store.attach_outcome(
            result.request_id,
            OutcomeLabel(field=field_name, actual_value=truth[field_name], observed_at=datetime.now(timezone.utc).isoformat()),
        )
    correct_count += 1 if prediction["approved"][0] == truth["approved"] else 0

print(f"\nLogged {N} simulated enterprise credit decisions ({len(decision.field_names)} fields each).")
print(f"'approved' field accuracy vs ground truth: {correct_count}/{N}")

print("\nCalibration reports:")
for field_name in ("approved", "aml_flag", "regulatory_hold", "requires_manual_underwriter_review"):
    report = get_calibration(store, decision_name=decision.name, field=field_name)
    print(f"  {field_name:<38} n={report.n:<5} ece={report.ece:.3f}  brier={report.brier:.3f}")
