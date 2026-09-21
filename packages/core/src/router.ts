import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { confidenceFieldKey } from "./schema.js";
import type { DecisionSchema } from "./schema.js";
import type {
  BackendAdapter,
  ConfidenceSignal,
  DecisionInput,
  DecisionResult,
  DecisionStore,
  FieldPrediction,
  RawBackendResponse,
} from "./types.js";

let warnedNoConfidence = false;

/**
 * Converts a backend-native confidence signal into a normalized 0-1 probability.
 * Deliberately conservative: a "none" signal normalizes to null, never a fabricated
 * 1.0 — inventing confidence would poison the calibration metrics that are the point
 * of this whole library.
 */
export function normalizeConfidence(signal: ConfidenceSignal): number | null {
  switch (signal.kind) {
    case "logprob":
      // Geometric-mean-per-token approximation of the field's probability. A heuristic,
      // not exact — this is why "self-reported" is the default strategy and "logprob" is opt-in.
      return Math.exp(signal.avgLogprob);
    case "self-reported":
      return signal.score;
    case "native":
      return signal.probability;
    case "none":
      return null;
  }
}

/**
 * Splits a backend's flat JSON response into clean field values and self-reported
 * confidence signals, using the `${field}_confidence` companion-key convention that
 * `defineDecision` writes into the wire schema when confidenceStrategy is "self-reported".
 */
export function extractSelfReported<Shape extends z.ZodRawShape>(
  decision: DecisionSchema<Shape>,
  parsedValues: Record<string, unknown>,
): { values: Record<string, unknown>; confidenceSignals: Record<string, ConfidenceSignal> } {
  const values: Record<string, unknown> = {};
  const confidenceSignals: Record<string, ConfidenceSignal> = {};
  for (const key of decision.fieldNames) {
    const fieldKey = String(key);
    values[fieldKey] = parsedValues[fieldKey];
    const rawScore = parsedValues[confidenceFieldKey(key)];
    confidenceSignals[fieldKey] =
      typeof rawScore === "number" ? { kind: "self-reported", score: rawScore } : { kind: "none" };
  }
  return { values, confidenceSignals };
}

export function buildFieldPredictions<Shape extends z.ZodRawShape>(
  decision: DecisionSchema<Shape>,
  raw: RawBackendResponse,
): DecisionResult<Shape>["fields"] {
  const parsedValues = decision.valuesSchema.parse(raw.values);
  const fields: Record<string, FieldPrediction> = {};

  for (const key of decision.fieldNames) {
    const fieldKey = String(key);
    const signal = raw.confidenceSignals[fieldKey] ?? { kind: "none" as const };
    const probability = normalizeConfidence(signal);

    if (probability === null && !warnedNoConfidence) {
      warnedNoConfidence = true;
      console.warn(
        `[jevcal] No confidence signal for field "${fieldKey}" (decision "${decision.name}") — probability recorded as null and excluded from calibration metrics. This warning prints once per process.`,
      );
    }

    fields[fieldKey] = {
      value: (parsedValues as Record<string, unknown>)[fieldKey],
      probability,
      raw: signal,
    };
  }

  return fields as DecisionResult<Shape>["fields"];
}

export interface DecisionRouterConfig {
  backend: BackendAdapter;
  store?: DecisionStore;
}

export class DecisionRouter {
  constructor(private readonly config: DecisionRouterConfig) {}

  async decide<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<DecisionResult<Shape>> {
    const raw = await this.config.backend.decide(decision, input);
    const fields = buildFieldPredictions(decision, raw);

    const result: DecisionResult<Shape> = {
      requestId: randomUUID(),
      decisionName: decision.name,
      schemaVersion: decision.version,
      backendId: this.config.backend.id,
      model: raw.model,
      timestamp: new Date().toISOString(),
      fields,
      raw: raw.raw,
    };

    if (this.config.store) {
      await this.config.store.logDecision(result as DecisionResult, input);
    }

    return result;
  }
}
