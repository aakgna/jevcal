from __future__ import annotations

import typing
from dataclasses import dataclass

import httpx

from ..schema import DecisionSchema
from ..types import ConfidenceSignal, DecisionInput, NativeSignal, NoneSignal, RawBackendResponse


@dataclass
class JevAdapterConfig:
    api_key: str
    base_url: str = "https://api.typesafe.ai/v1"
    model: str = "jev-latest"
    # Required for any int/float field. Jev's "score" question type evaluates
    # against an explicit ordered rubric (2-10 levels) — there's no generic way
    # to derive that from a bare number type, so it must be supplied here,
    # keyed by field name, as an ordered list of level descriptions.
    score_criteria: dict[str, list[str]] | None = None
    # Optional per-option descriptions for Literal (choice) fields; defaults to
    # each option's own literal value as its description.
    choice_criteria: dict[str, dict[str, str]] | None = None
    # Optional true/false descriptions for bool (noul) fields.
    noul_criteria: dict[str, dict[str, str]] | None = None


def _state_from_input(input: DecisionInput) -> str:
    if isinstance(input.input, str):
        return input.input
    return "\n".join(f"{m['role']}: {m['content']}" for m in input.input)


class JevAdapter:
    """Calls Typesafe AI's Jev directly — `POST https://api.typesafe.ai/v1/systemone`,
    using your own TypeSafe API key. Maps typed decision fields onto Jev's
    choice/score/noul question types:

      bool                  -> noul   (probability the statement is true)
      Literal[...]          -> choice (probability distribution over options)
      int/float + rubric    -> score  (position across an ordered rubric)

    Confirmed against live responses, not just documentation — see
    docs/JEV_API.md in the repo for the verified request/response shapes this
    follows, including the easy-to-miss requirement that the request body
    include a "model" field.

    Confidence is recorded as `{kind: "native"}` — a first-class API-level
    probability, not elicited via prompting or derived from token logprobs.
    """

    id = "jev"
    capabilities = {"logprobs": False}

    def __init__(self, config: JevAdapterConfig) -> None:
        self.config = config

    def decide(self, decision: DecisionSchema, input: DecisionInput) -> RawBackendResponse:
        field_infos = decision.values_model.model_fields
        field_types: dict[str, str] = {}
        questions: dict[str, dict] = {}

        for field_name in decision.field_names:
            field_info = field_infos[field_name]
            instructions = field_info.description
            if not instructions:
                raise ValueError(
                    f'JevAdapter: field "{field_name}" needs a description (Field(description=...)) — '
                    'Jev requires an "instructions" string per question.'
                )

            annotation = field_info.annotation
            origin = typing.get_origin(annotation)

            if annotation is bool:
                field_types[field_name] = "noul"
                question: dict = {"type": "noul", "instructions": instructions}
                if self.config.noul_criteria and field_name in self.config.noul_criteria:
                    question["criteria"] = self.config.noul_criteria[field_name]
                questions[field_name] = question

            elif origin is typing.Literal:
                field_types[field_name] = "choice"
                options = typing.get_args(annotation)
                criteria = (self.config.choice_criteria or {}).get(field_name) or {opt: opt for opt in options}
                questions[field_name] = {"type": "choice", "instructions": instructions, "criteria": criteria}

            elif annotation in (int, float):
                criteria = (self.config.score_criteria or {}).get(field_name)
                if not criteria:
                    raise ValueError(
                        f'JevAdapter: numeric field "{field_name}" needs score_criteria (an ordered list of '
                        '2-10 rubric level descriptions) in the adapter config — Jev\'s "score" question type '
                        "can't infer a rubric from a bare number type."
                    )
                field_types[field_name] = "score"
                questions[field_name] = {"type": "score", "instructions": instructions, "criteria": criteria}

            else:
                raise ValueError(
                    f'JevAdapter: field "{field_name}" has an unsupported type for Jev routing — only bool '
                    "(noul), Literal (choice), and int/float+score_criteria (score) fields are supported."
                )

        response = httpx.post(
            f"{self.config.base_url}/systemone",
            headers={"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"},
            json={"state": _state_from_input(input), "model": self.config.model, "questions": questions},
            timeout=30.0,
        )
        if response.is_error:
            raise RuntimeError(
                f"JevAdapter request failed: {response.status_code} {response.reason_phrase} — {response.text}"
            )

        body = response.json()
        answers = body.get("answers", {})
        values: dict[str, object] = {}
        confidence_signals: dict[str, ConfidenceSignal] = {}

        for field_name in decision.field_names:
            answer = answers.get(field_name)
            if not answer:
                values[field_name] = None
                confidence_signals[field_name] = NoneSignal()
                continue

            kind = field_types[field_name]
            if kind == "noul":
                noul = answer.get("noul", 0)
                values[field_name] = noul > 0.5
                confidence_signals[field_name] = NativeSignal(probability=noul)
            else:  # choice or score
                values[field_name] = answer.get("choice") if kind == "choice" else answer.get("score")
                confidence_signals[field_name] = NativeSignal(
                    probability=answer.get("confidence", 0),
                    distribution=answer.get("probabilities"),
                )

        return RawBackendResponse(
            values=values, confidence_signals=confidence_signals, model=body.get("model"), raw=body
        )
