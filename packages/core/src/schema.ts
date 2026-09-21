import { z } from "zod";
import type { ConfidenceStrategy } from "./types.js";

export interface DecisionSchema<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  version: string;
  confidenceStrategy: ConfidenceStrategy;
  /**
   * Plain Zod object usable anywhere a ZodSchema is expected (generateObject,
   * withStructuredOutput, etc). When confidenceStrategy is "self-reported" this
   * carries extra `${field}_confidence` keys at runtime that callers outside
   * jevcal can safely ignore; the router strips them back out.
   */
  schema: z.ZodObject<Shape>;
  /** The original, un-augmented field shape — always safe to `.parse()` a backend's cleaned value object against. */
  valuesSchema: z.ZodObject<Shape>;
  fieldNames: (keyof Shape)[];
}

export interface DefineDecisionOptions<Shape extends z.ZodRawShape> {
  name: string;
  /** Schema version — segments calibration data and unlocks per-version drift tracking later. */
  version?: string;
  /** Defaults to "self-reported" since it's the only strategy portable to every backend. */
  confidence?: ConfidenceStrategy;
  fields: z.ZodObject<Shape>;
}

export function confidenceFieldKey(field: string | number | symbol): string {
  return `${String(field)}_confidence`;
}

export function defineDecision<Shape extends z.ZodRawShape>(
  options: DefineDecisionOptions<Shape>,
): DecisionSchema<Shape> {
  const confidenceStrategy = options.confidence ?? "self-reported";
  const fieldNames = Object.keys(options.fields.shape) as (keyof Shape)[];

  let schema: z.ZodObject<z.ZodRawShape> = options.fields;
  if (confidenceStrategy === "self-reported") {
    const confidenceFields: Record<string, z.ZodTypeAny> = {};
    for (const key of fieldNames) {
      confidenceFields[confidenceFieldKey(key)] = z
        .number()
        .min(0)
        .max(1)
        .describe(`Self-rated confidence (0-1) that the "${String(key)}" field above is correct.`);
    }
    schema = options.fields.extend(confidenceFields);
  }

  return {
    name: options.name,
    version: options.version ?? "1",
    confidenceStrategy,
    schema: schema as z.ZodObject<Shape>,
    valuesSchema: options.fields,
    fieldNames,
  };
}
