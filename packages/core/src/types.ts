import type { z } from "zod";
import type { DecisionSchema } from "./schema.js";

export type ConfidenceStrategy = "self-reported" | "logprob" | "none";

export type ConfidenceSignal =
  | { kind: "logprob"; avgLogprob: number; tokenCount: number }
  | { kind: "self-reported"; score: number }
  /** First-class probability computed by the backend itself (e.g. Jev's choice/score/noul), not derived or elicited. */
  | { kind: "native"; probability: number; distribution?: Record<string, number> }
  | { kind: "none" };

export interface FieldPrediction<T = unknown> {
  value: T;
  /** Normalized 0-1 probability, or null if the backend reported no usable confidence signal. */
  probability: number | null;
  raw?: ConfidenceSignal;
}

export interface DecisionInputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DecisionInput {
  input: string | DecisionInputMessage[];
  metadata?: Record<string, unknown>;
}

export interface DecisionResult<Shape extends z.ZodRawShape = z.ZodRawShape> {
  requestId: string;
  decisionName: string;
  schemaVersion: string;
  backendId: string;
  model?: string;
  timestamp: string;
  fields: { [K in keyof Shape]: FieldPrediction<z.infer<Shape[K]>> };
  raw: unknown;
}

export interface RawBackendResponse {
  values: Record<string, unknown>;
  confidenceSignals: Record<string, ConfidenceSignal>;
  model?: string;
  raw: unknown;
}

export interface BackendAdapter {
  id: string;
  capabilities: { logprobs: boolean };
  decide<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<RawBackendResponse>;
}

export interface OutcomeLabel {
  field: string;
  actualValue: unknown;
  observedAt: string;
  metadata?: Record<string, unknown>;
}

export interface LoggedDecisionRecord {
  requestId: string;
  decisionName: string;
  schemaVersion: string;
  backendId: string;
  model?: string;
  timestamp: string;
  input?: DecisionInput;
  fields: Record<string, FieldPrediction<unknown>>;
  outcomes: Record<string, OutcomeLabel>;
}

export interface DecisionStore {
  logDecision(result: DecisionResult<z.ZodRawShape>, input: DecisionInput): Promise<void>;
  attachOutcome(requestId: string, outcome: OutcomeLabel): Promise<void>;
  getRecords(query?: { decisionName?: string; since?: string }): Promise<LoggedDecisionRecord[]>;
}

export interface CalibrationSample {
  predictedProbability: number;
  correct: boolean;
}

export interface ReliabilityBin {
  binStart: number;
  binEnd: number;
  avgPredictedProbability: number;
  observedFrequency: number;
  sampleCount: number;
}

export type CorrectnessComparator = (predicted: unknown, actual: unknown) => boolean;
