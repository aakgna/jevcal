from __future__ import annotations

from .types import CalibrationSample, ReliabilityBin


def _clamp_bin_index(probability: float, num_bins: int) -> int:
    idx = int(probability * num_bins)
    return min(idx, num_bins - 1)


def compute_reliability_diagram(samples: list[CalibrationSample], num_bins: int = 10) -> list[ReliabilityBin]:
    """Bins samples by predicted probability and reports predicted-vs-observed frequency per bin."""
    bins = [{"probability_sum": 0.0, "correct_count": 0, "sample_count": 0} for _ in range(num_bins)]

    for sample in samples:
        idx = _clamp_bin_index(sample.predicted_probability, num_bins)
        bucket = bins[idx]
        bucket["probability_sum"] += sample.predicted_probability
        bucket["correct_count"] += 1 if sample.correct else 0
        bucket["sample_count"] += 1

    result: list[ReliabilityBin] = []
    for idx, bucket in enumerate(bins):
        bin_start = idx / num_bins
        bin_end = (idx + 1) / num_bins
        sample_count = bucket["sample_count"]
        avg_predicted = bucket["probability_sum"] / sample_count if sample_count > 0 else (bin_start + bin_end) / 2
        observed = bucket["correct_count"] / sample_count if sample_count > 0 else 0.0
        result.append(
            ReliabilityBin(
                bin_start=bin_start,
                bin_end=bin_end,
                avg_predicted_probability=avg_predicted,
                observed_frequency=observed,
                sample_count=sample_count,
            )
        )
    return result


def compute_ece(samples: list[CalibrationSample], num_bins: int = 10) -> float:
    """Expected Calibration Error: sample-weighted average gap between each bin's
    average predicted probability and its observed frequency of being correct."""
    if not samples:
        return 0.0

    bins = compute_reliability_diagram(samples, num_bins)
    total = len(samples)

    ece = 0.0
    for bucket in bins:
        if bucket.sample_count == 0:
            continue
        gap = abs(bucket.avg_predicted_probability - bucket.observed_frequency)
        ece += (bucket.sample_count / total) * gap
    return ece


def compute_brier_score(samples: list[CalibrationSample]) -> float:
    """Mean squared error between predicted probability and the binary outcome."""
    if not samples:
        return 0.0
    total_squared_error = 0.0
    for sample in samples:
        outcome = 1.0 if sample.correct else 0.0
        total_squared_error += (sample.predicted_probability - outcome) ** 2
    return total_squared_error / len(samples)
