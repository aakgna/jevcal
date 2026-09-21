import json
from typing import Literal

import httpx
import pytest
from pydantic import BaseModel, Field

from jevcal import DecisionInput, JevAdapter, JevAdapterConfig, define_decision


class LoanFields(BaseModel):
    approved: bool = Field(description="Should this loan be approved?")
    risk_tier: Literal["low", "medium", "high"] = Field(description="Risk classification for this applicant")
    severity_score: float = Field(description="How severe is the applicant's credit risk?")


decision = define_decision(name="loan-approval", fields=LoanFields, confidence="none")


class FakeResponse:
    def __init__(self, body: dict, status_code: int = 200):
        self._body = body
        self.status_code = status_code
        self.reason_phrase = "OK" if status_code < 400 else "Error"
        self.is_error = status_code >= 400
        self.text = json.dumps(body)

    def json(self):
        return self._body


def test_maps_fields_to_noul_choice_score_and_sends_model_in_body(monkeypatch):
    captured = {}

    def fake_post(url, headers, json, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = json
        return FakeResponse(
            {
                "model": "jev-1.13.0",
                "answers": {
                    "approved": {"type": "noul", "noul": 0.92},
                    "risk_tier": {
                        "type": "choice",
                        "choice": "low",
                        "confidence": 0.81,
                        "probabilities": {"low": 0.81, "medium": 0.15, "high": 0.04},
                    },
                    "severity_score": {
                        "type": "score",
                        "score": 1.3,
                        "confidence": 0.54,
                        "probabilities": {"0": 0.0, "1": 0.7, "2": 0.3},
                    },
                },
                "usage": {"input_tokens": 100, "output_tokens": 20},
            }
        )

    monkeypatch.setattr(httpx, "post", fake_post)

    adapter = JevAdapter(JevAdapterConfig(api_key="test-key", score_criteria={"severity_score": ["none", "moderate", "severe"]}))
    result = adapter.decide(decision, DecisionInput(input="Applicant has a thin credit file."))

    assert captured["url"] == "https://api.typesafe.ai/v1/systemone"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    body = captured["body"]
    assert body["model"] == "jev-latest"
    assert body["questions"]["approved"]["type"] == "noul"
    assert body["questions"]["risk_tier"] == {
        "type": "choice",
        "instructions": "Risk classification for this applicant",
        "criteria": {"low": "low", "medium": "medium", "high": "high"},
    }
    assert body["questions"]["severity_score"]["criteria"] == ["none", "moderate", "severe"]

    assert result.values["approved"] is True
    assert result.confidence_signals["approved"].kind == "native"
    assert result.confidence_signals["approved"].probability == 0.92

    assert result.values["risk_tier"] == "low"
    assert result.confidence_signals["risk_tier"].probability == 0.81
    assert result.confidence_signals["risk_tier"].distribution == {"low": 0.81, "medium": 0.15, "high": 0.04}

    assert result.values["severity_score"] == 1.3
    assert result.model == "jev-1.13.0"


def test_flips_noul_into_confidence_in_predicted_value_when_confidently_false(monkeypatch):
    # noul is P(statement is true). A confident false prediction (noul=0.05) must
    # report probability=0.95 (confidence in "false"), not 0.05 — regression test
    # for the boolean calibration semantics bug.
    def fake_post(url, headers, json, timeout):
        return FakeResponse(
            {
                "model": "jev-1.13.0",
                "answers": {
                    "approved": {"type": "noul", "noul": 0.05},
                    "risk_tier": {
                        "type": "choice",
                        "choice": "high",
                        "confidence": 0.7,
                        "probabilities": {"low": 0.1, "medium": 0.2, "high": 0.7},
                    },
                    "severity_score": {
                        "type": "score",
                        "score": 1.8,
                        "confidence": 0.6,
                        "probabilities": {"0": 0.0, "1": 0.3, "2": 0.7},
                    },
                },
                "usage": {"input_tokens": 100, "output_tokens": 20},
            }
        )

    monkeypatch.setattr(httpx, "post", fake_post)

    adapter = JevAdapter(JevAdapterConfig(api_key="test-key", score_criteria={"severity_score": ["none", "moderate", "severe"]}))
    result = adapter.decide(decision, DecisionInput(input="Applicant has a thin credit file."))

    assert result.values["approved"] is False
    assert result.confidence_signals["approved"].kind == "native"
    assert result.confidence_signals["approved"].probability == 0.95


def test_raises_clear_error_when_number_field_missing_score_criteria(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResponse({"answers": {}}))
    adapter = JevAdapter(JevAdapterConfig(api_key="test-key"))
    with pytest.raises(ValueError, match="score_criteria"):
        adapter.decide(decision, DecisionInput(input="state"))


def test_raises_clear_error_when_field_missing_description(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResponse({"answers": {}}))

    class Undescribed(BaseModel):
        ok: bool

    undescribed_decision = define_decision(name="undescribed", fields=Undescribed, confidence="none")
    adapter = JevAdapter(JevAdapterConfig(api_key="test-key"))
    with pytest.raises(ValueError, match="description"):
        adapter.decide(undescribed_decision, DecisionInput(input="state"))


def test_raises_on_http_error(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResponse({"error": "bad key"}, status_code=401))
    adapter = JevAdapter(JevAdapterConfig(api_key="bad-key", score_criteria={"severity_score": ["a", "b"]}))
    with pytest.raises(RuntimeError, match="401"):
        adapter.decide(decision, DecisionInput(input="state"))
