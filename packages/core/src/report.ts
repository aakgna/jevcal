import { computeBrierScore, computeECE, computeReliabilityDiagram } from "./calibration.js";
import type { CalibrationSample, CorrectnessComparator, DecisionStore, ReliabilityBin } from "./types.js";

export interface CalibrationReport {
  n: number;
  ece: number;
  brier: number;
  reliability: ReliabilityBin[];
}

export interface GetCalibrationOptions {
  decisionName: string;
  field: string;
  numBins?: number;
  /** Defaults to strict equality — override for fields needing tolerance-based correctness (e.g. numeric). */
  comparator?: CorrectnessComparator;
}

const defaultComparator: CorrectnessComparator = (predicted, actual) => predicted === actual;

/**
 * Joins logged decisions with their attached outcomes and computes calibration
 * metrics for one field. Records missing an outcome, or whose recorded probability
 * is null (no usable confidence signal), are excluded rather than treated as wrong.
 */
export async function getCalibration(
  store: DecisionStore,
  options: GetCalibrationOptions,
): Promise<CalibrationReport> {
  const comparator = options.comparator ?? defaultComparator;
  const records = await store.getRecords({ decisionName: options.decisionName });

  const samples: CalibrationSample[] = [];
  for (const record of records) {
    const prediction = record.fields[options.field];
    const outcome = record.outcomes[options.field];
    if (!prediction || !outcome || prediction.probability === null) continue;
    samples.push({
      predictedProbability: prediction.probability,
      correct: comparator(prediction.value, outcome.actualValue),
    });
  }

  return {
    n: samples.length,
    ece: computeECE(samples, options.numBins),
    brier: computeBrierScore(samples),
    reliability: computeReliabilityDiagram(samples, options.numBins),
  };
}
