import type { CalibrationSample, ReliabilityBin } from "./types.js";

function clampBinIndex(probability: number, numBins: number): number {
  const idx = Math.floor(probability * numBins);
  return Math.min(idx, numBins - 1);
}

/**
 * Expected Calibration Error: bins predictions by predicted probability, then
 * takes the sample-weighted average gap between each bin's average predicted
 * probability and its observed frequency of being correct.
 */
export function computeECE(samples: CalibrationSample[], numBins = 10): number {
  if (samples.length === 0) return 0;

  const bins = computeReliabilityDiagram(samples, numBins);
  const total = samples.length;

  let ece = 0;
  for (const bin of bins) {
    if (bin.sampleCount === 0) continue;
    const gap = Math.abs(bin.avgPredictedProbability - bin.observedFrequency);
    ece += (bin.sampleCount / total) * gap;
  }
  return ece;
}

/** Brier score: mean squared error between predicted probability and the binary outcome. */
export function computeBrierScore(samples: CalibrationSample[]): number {
  if (samples.length === 0) return 0;
  let sumSquaredError = 0;
  for (const sample of samples) {
    const outcome = sample.correct ? 1 : 0;
    sumSquaredError += (sample.predictedProbability - outcome) ** 2;
  }
  return sumSquaredError / samples.length;
}

/** Bins samples by predicted probability and reports predicted-vs-observed frequency per bin. */
export function computeReliabilityDiagram(
  samples: CalibrationSample[],
  numBins = 10,
): ReliabilityBin[] {
  const bins: { probabilitySum: number; correctCount: number; sampleCount: number }[] = Array.from(
    { length: numBins },
    () => ({ probabilitySum: 0, correctCount: 0, sampleCount: 0 }),
  );

  for (const sample of samples) {
    const idx = clampBinIndex(sample.predictedProbability, numBins);
    const bin = bins[idx];
    if (!bin) continue;
    bin.probabilitySum += sample.predictedProbability;
    bin.correctCount += sample.correct ? 1 : 0;
    bin.sampleCount += 1;
  }

  return bins.map((bin, idx) => {
    const binStart = idx / numBins;
    const binEnd = (idx + 1) / numBins;
    return {
      binStart,
      binEnd,
      avgPredictedProbability:
        bin.sampleCount > 0 ? bin.probabilitySum / bin.sampleCount : (binStart + binEnd) / 2,
      observedFrequency: bin.sampleCount > 0 ? bin.correctCount / bin.sampleCount : 0,
      sampleCount: bin.sampleCount,
    };
  });
}
