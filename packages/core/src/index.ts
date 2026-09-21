export { confidenceFieldKey, defineDecision } from "./schema.js";
export type { DecisionSchema, DefineDecisionOptions } from "./schema.js";

export { computeBrierScore, computeECE, computeReliabilityDiagram } from "./calibration.js";

export { getCalibration } from "./report.js";
export type { CalibrationReport, GetCalibrationOptions } from "./report.js";

export { buildFieldPredictions, DecisionRouter, extractSelfReported, normalizeConfidence } from "./router.js";
export type { DecisionRouterConfig } from "./router.js";

export { JsonlStore } from "./store/jsonl.js";
export { SqliteStore } from "./store/sqlite.js";

export type {
  BackendAdapter,
  CalibrationSample,
  ConfidenceSignal,
  ConfidenceStrategy,
  CorrectnessComparator,
  DecisionInput,
  DecisionInputMessage,
  DecisionResult,
  DecisionStore,
  FieldPrediction,
  LoggedDecisionRecord,
  OutcomeLabel,
  RawBackendResponse,
  ReliabilityBin,
} from "./types.js";
