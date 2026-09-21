"""Real call to Jev through the Python JevAdapter — the direct transport,
POST https://api.typesafe.ai/v1/systemone, using JEV_API_KEY from the repo's
.env. Same live-verification bar as every other adapter this session: this
runs a real request and checks the real response, not a mock.

    JEV_API_KEY=... python3 main.py
"""

import os
from typing import Literal

from pydantic import BaseModel, Field

from jevcal import DecisionInput, DecisionRouter, JevAdapter, JevAdapterConfig, JsonlStore, define_decision


class LoanFields(BaseModel):
    approved: bool = Field(description="Whether the loan should be approved")
    risk_tier: Literal["low", "medium", "high"] = Field(description="Risk classification for this applicant")


decision = define_decision(name="loan-approval-py", fields=LoanFields, confidence="none")

store = JsonlStore(".jevcal/decisions.jsonl")
adapter = JevAdapter(JevAdapterConfig(api_key=os.environ["JEV_API_KEY"]))
router = DecisionRouter(backend=adapter, store=store)

result = router.decide(
    decision,
    DecisionInput(
        input="Applicant: credit score 705, debt-to-income 0.35, 3 years at current job, "
        "no prior defaults, requesting $10,000 for a car purchase."
    ),
)

print(f"model:     {result.model}")
print(f"approved:  {result.fields['approved'].value}  ({result.fields['approved'].probability:.0%})")
print(f"risk_tier: {result.fields['risk_tier'].value}  ({result.fields['risk_tier'].probability:.0%})")
print(f"confidence signal kind: {result.fields['approved'].raw.kind}")
assert result.fields["approved"].raw.kind == "native", "Jev confidence should be a first-class native signal"
