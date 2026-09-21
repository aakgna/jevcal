import pytest
from jevcal.calibration import compute_brier_score, compute_ece, compute_reliability_diagram
from jevcal.types import CalibrationSample


def _perfectly_calibrated_samples() -> list[CalibrationSample]:
    samples: list[CalibrationSample] = []
    for i in range(10):
        p = (i + 0.5) / 10  # 0.05, 0.15, ..., 0.95
        correct_count = round(p * 100)  # exact integer for these p values
        for j in range(100):
            samples.append(CalibrationSample(predicted_probability=p, correct=j < correct_count))
    return samples


def test_ece_is_zero_for_perfectly_calibrated_predictions():
    ece = compute_ece(_perfectly_calibrated_samples(), num_bins=10)
    assert ece == pytest.approx(0, abs=1e-10)


def test_ece_is_high_for_overconfident_model():
    samples = [CalibrationSample(predicted_probability=0.99, correct=i < 50) for i in range(100)]
    ece = compute_ece(samples, num_bins=10)
    assert ece == pytest.approx(0.49, abs=1e-5)


def test_ece_is_zero_for_empty_samples():
    assert compute_ece([]) == 0.0


def test_brier_is_zero_for_confident_correct_calls():
    samples = [CalibrationSample(predicted_probability=1, correct=True) for _ in range(10)]
    assert compute_brier_score(samples) == 0.0


def test_brier_is_one_for_confident_wrong_calls():
    samples = [CalibrationSample(predicted_probability=1, correct=False) for _ in range(10)]
    assert compute_brier_score(samples) == 1.0


def test_brier_is_quarter_for_half_confidence_regardless_of_outcome():
    samples = [
        CalibrationSample(predicted_probability=0.5, correct=True),
        CalibrationSample(predicted_probability=0.5, correct=False),
        CalibrationSample(predicted_probability=0.5, correct=True),
    ]
    assert compute_brier_score(samples) == pytest.approx(0.25, abs=1e-10)


def test_reliability_diagram_covers_0_to_1_even_with_no_samples():
    bins = compute_reliability_diagram([], num_bins=10)
    assert len(bins) == 10
    assert bins[0].bin_start == 0
    assert bins[9].bin_end == 1
    assert all(b.sample_count == 0 for b in bins)


def test_reliability_diagram_assigns_samples_to_correct_bin():
    samples = [
        CalibrationSample(predicted_probability=0.72, correct=True),
        CalibrationSample(predicted_probability=0.78, correct=False),
    ]
    bins = compute_reliability_diagram(samples, num_bins=10)
    bin7 = bins[7]  # [0.7, 0.8)
    assert bin7.sample_count == 2
    assert bin7.observed_frequency == pytest.approx(0.5, abs=1e-10)
    assert bin7.avg_predicted_probability == pytest.approx(0.75, abs=1e-10)


def test_reliability_diagram_clamps_probability_of_exactly_one_into_last_bin():
    bins = compute_reliability_diagram([CalibrationSample(predicted_probability=1.0, correct=True)], num_bins=10)
    assert bins[9].sample_count == 1
