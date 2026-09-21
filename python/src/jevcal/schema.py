from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field

from pydantic import BaseModel, Field, create_model

from .types import ConfidenceStrategy


def confidence_field_key(field_name: str) -> str:
    return f"{field_name}_confidence"


@dataclass(frozen=True)
class DecisionSchema:
    name: str
    version: str
    confidence_strategy: ConfidenceStrategy
    # Possibly augmented with `${field}_confidence` companion fields — usable
    # anywhere a plain Pydantic model is expected; safe to ignore the extra
    # keys outside jevcal, since the router strips them back out.
    wire_model: type[BaseModel]
    # The original, un-augmented field model — always safe to validate a
    # backend's cleaned value dict against.
    values_model: type[BaseModel]
    field_names: list[str] = dataclass_field(default_factory=list)


def define_decision(
    *,
    name: str,
    fields: type[BaseModel],
    version: str = "1",
    confidence: ConfidenceStrategy = "self-reported",
) -> DecisionSchema:
    """Defines a typed decision. `fields` is a plain Pydantic model — usable
    directly anywhere a schema is expected, no jevcal involvement required.

    `confidence` defaults to "self-reported" since it's the only strategy
    portable to every backend. When set, `wire_model` transparently gains a
    `${field}_confidence` companion field per top-level key.
    """
    field_names = list(fields.model_fields.keys())

    wire_model: type[BaseModel] = fields
    if confidence == "self-reported":
        extra_fields = {
            confidence_field_key(field_name): (
                float,
                Field(
                    ge=0,
                    le=1,
                    description=f'Self-rated confidence (0-1) that the "{field_name}" field above is correct.',
                ),
            )
            for field_name in field_names
        }
        wire_model = create_model(f"{fields.__name__}Wire", __base__=fields, **extra_fields)

    return DecisionSchema(
        name=name,
        version=version,
        confidence_strategy=confidence,
        wire_model=wire_model,
        values_model=fields,
        field_names=field_names,
    )
