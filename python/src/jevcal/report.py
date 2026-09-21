from __future__ import annotations

from typing import Callable

from pydantic import BaseModel

from .calibration import compute_brier_score, compute_ece, compute_reliability_diagram
from .store import JsonlStore
from .types import CalibrationSample, ReliabilityBin

CorrectnessComparator = Callable[[object, object], bool]


class CalibrationReport(BaseModel):
    n: int
    ece: float
    brier: float
    reliability: list[ReliabilityBin]


def _default_comparator(predicted: object, actual: object) -> bool:
    return predicted == actual


def get_calibration(
    store: JsonlStore,
    *,
    decision_name: str,
    field: str,
    num_bins: int = 10,
    comparator: CorrectnessComparator | None = None,
) -> CalibrationReport:
    """Joins logged decisions with their attached outcomes and computes
    calibration metrics for one field. Records missing an outcome, or whose
    recorded probability is None (no usable confidence signal), are excluded
    rather than treated as wrong."""
    comparator = comparator or _default_comparator
    records = store.get_records(decision_name=decision_name)

    samples: list[CalibrationSample] = []
    for record in records:
        prediction = record.fields.get(field)
        outcome = record.outcomes.get(field)
        if prediction is None or outcome is None or prediction.probability is None:
            continue
        samples.append(
            CalibrationSample(
                predicted_probability=prediction.probability,
                correct=comparator(prediction.value, outcome.actual_value),
            )
        )

    return CalibrationReport(
        n=len(samples),
        ece=compute_ece(samples, num_bins),
        brier=compute_brier_score(samples),
        reliability=compute_reliability_diagram(samples, num_bins),
    )
