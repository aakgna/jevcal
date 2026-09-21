import { describe, expect, it } from "vitest";
import { computeBrierScore, computeECE, computeReliabilityDiagram } from "./calibration.js";
import type { CalibrationSample } from "./types.js";

function perfectlyCalibratedSamples(): CalibrationSample[] {
  const samples: CalibrationSample[] = [];
  for (let i = 0; i < 10; i++) {
    const p = (i + 0.5) / 10; // 0.05, 0.15, ..., 0.95
    const correctCount = Math.round(p * 100); // exact integer for these p values
    for (let j = 0; j < 100; j++) {
      samples.push({ predictedProbability: p, correct: j < correctCount });
    }
  }
  return samples;
}

describe("computeECE", () => {
  it("is ~0 for a perfectly calibrated set of predictions", () => {
    const ece = computeECE(perfectlyCalibratedSamples(), 10);
    expect(ece).toBeCloseTo(0, 10);
  });

  it("is high for an overconfident model (high stated probability, low accuracy)", () => {
    const samples: CalibrationSample[] = Array.from({ length: 100 }, (_, i) => ({
      predictedProbability: 0.99,
      correct: i < 50,
    }));
    const ece = computeECE(samples, 10);
    expect(ece).toBeCloseTo(0.49, 5);
  });

  it("returns 0 for an empty sample set", () => {
    expect(computeECE([])).toBe(0);
  });
});

describe("computeBrierScore", () => {
  it("is 0 when every prediction is a fully confident correct call", () => {
    const samples: CalibrationSample[] = Array.from({ length: 10 }, () => ({
      predictedProbability: 1,
      correct: true,
    }));
    expect(computeBrierScore(samples)).toBe(0);
  });

  it("is 1 when every prediction is a fully confident wrong call", () => {
    const samples: CalibrationSample[] = Array.from({ length: 10 }, () => ({
      predictedProbability: 1,
      correct: false,
    }));
    expect(computeBrierScore(samples)).toBe(1);
  });

  it("is 0.25 for p=0.5 predictions regardless of outcome mix", () => {
    const samples: CalibrationSample[] = [
      { predictedProbability: 0.5, correct: true },
      { predictedProbability: 0.5, correct: false },
      { predictedProbability: 0.5, correct: true },
    ];
    expect(computeBrierScore(samples)).toBeCloseTo(0.25, 10);
  });
});

describe("computeReliabilityDiagram", () => {
  it("produces numBins bins covering [0,1] even with no samples", () => {
    const bins = computeReliabilityDiagram([], 10);
    expect(bins).toHaveLength(10);
    expect(bins[0]?.binStart).toBe(0);
    expect(bins[9]?.binEnd).toBe(1);
    expect(bins.every((b) => b.sampleCount === 0)).toBe(true);
  });

  it("assigns each sample to the correct bin and reports observed frequency", () => {
    const samples: CalibrationSample[] = [
      { predictedProbability: 0.72, correct: true },
      { predictedProbability: 0.78, correct: false },
    ];
    const bins = computeReliabilityDiagram(samples, 10);
    const bin7 = bins[7]; // [0.7, 0.8)
    expect(bin7?.sampleCount).toBe(2);
    expect(bin7?.observedFrequency).toBeCloseTo(0.5, 10);
    expect(bin7?.avgPredictedProbability).toBeCloseTo(0.75, 10);
  });

  it("clamps a predicted probability of exactly 1.0 into the last bin", () => {
    const bins = computeReliabilityDiagram([{ predictedProbability: 1.0, correct: true }], 10);
    expect(bins[9]?.sampleCount).toBe(1);
  });
});
