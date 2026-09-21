import type {
  BackendAdapter,
  ConfidenceSignal,
  DecisionInput,
  DecisionSchema,
  RawBackendResponse,
} from "@jevcal/core";
import { experimental_evaluate as evaluate } from "ai";
import type { Experimental_EvaluationQuestion } from "ai";
import { z } from "zod";

export interface JevAdapterConfig {
  /**
   * "direct" calls api.typesafe.ai with your own TypeSafe API key. "gateway" calls
   * through the Vercel AI Gateway's evaluation-model interface, authenticated by an
   * AI_GATEWAY_API_KEY (or Vercel OIDC) already in the environment — no separate
   * TypeSafe account needed. Defaults to "direct" if `apiKey` is set, else "gateway".
   */
  transport?: "direct" | "gateway";
  /** TypeSafe API key. Required when transport is (or defaults to) "direct". */
  apiKey?: string;
  /** Direct-transport base URL. Defaults to "https://api.typesafe.ai/v1". */
  baseURL?: string;
  /** Model slug. Defaults to "jev-latest" (direct) or "typesafe-ai/jev" (gateway). */
  model?: string;
  /**
   * Required for any z.number() field. Jev's "score" question type evaluates
   * against an explicit ordered rubric (2-10 levels) — there's no generic way to
   * derive that from a bare Zod number type, so it must be supplied here, keyed by
   * field name, as an ordered array of level descriptions (lowest first).
   */
  scoreCriteria?: Record<string, string[]>;
  /** Optional per-option descriptions for enum (choice) fields; defaults to each option's own literal value as its description. */
  choiceCriteria?: Record<string, Record<string, string>>;
  /** Optional true/false descriptions for boolean fields. */
  booleanCriteria?: Record<string, { true?: string; false?: string }>;
}

type FieldType = "choice" | "score" | "bool";

function stateFromInput(input: DecisionInput): string {
  if (typeof input.input === "string") return input.input;
  return input.input.map((m) => `${m.role}: ${m.content}`).join("\n");
}

/** Builds {questions, fieldTypes} shared by both transports — only the boolean question's `type` key name differs ("noul" direct vs "boolean" gateway). */
function buildQuestions<Shape extends z.ZodRawShape>(
  decision: DecisionSchema<Shape>,
  config: JevAdapterConfig,
  boolTypeName: "noul" | "boolean",
): { questions: Record<string, unknown>; fieldTypes: Record<string, FieldType> } {
  const shape = decision.valuesSchema.shape;
  const fieldTypes: Record<string, FieldType> = {};
  const questions: Record<string, unknown> = {};

  for (const key of decision.fieldNames) {
    const fieldKey = String(key);
    const zodType = shape[fieldKey as keyof typeof shape] as z.ZodTypeAny | undefined;
    const instructions = zodType?.description;
    if (!zodType || !instructions) {
      throw new Error(
        `JevAdapter: field "${fieldKey}" needs a .describe("...") call on its Zod type — Jev requires an "instructions" string per question.`,
      );
    }

    if (zodType instanceof z.ZodBoolean) {
      fieldTypes[fieldKey] = "bool";
      questions[fieldKey] = {
        type: boolTypeName,
        instructions,
        criteria: config.booleanCriteria?.[fieldKey],
      };
    } else if (zodType instanceof z.ZodEnum) {
      fieldTypes[fieldKey] = "choice";
      const options = zodType.options as string[];
      const criteria =
        config.choiceCriteria?.[fieldKey] ?? Object.fromEntries(options.map((o) => [o, o]));
      questions[fieldKey] = { type: "choice", instructions, criteria };
    } else if (zodType instanceof z.ZodNumber) {
      const criteria = config.scoreCriteria?.[fieldKey];
      if (!criteria) {
        throw new Error(
          `JevAdapter: numeric field "${fieldKey}" needs scoreCriteria (an ordered array of 2-10 rubric level descriptions) in the adapter config — Jev's "score" question type can't infer a rubric from a bare number type.`,
        );
      }
      fieldTypes[fieldKey] = "score";
      questions[fieldKey] = { type: "score", instructions, criteria };
    } else {
      throw new Error(
        `JevAdapter: field "${fieldKey}" has an unsupported type for Jev routing — only boolean, enum (choice), and number+scoreCriteria (score) fields are supported.`,
      );
    }
  }

  return { questions, fieldTypes };
}

interface DirectAnswer {
  type: "noul" | "choice" | "score";
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}
interface DirectResponse {
  model?: string;
  answers: Record<string, DirectAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Calls Typesafe AI's Jev. Two verified transports:
 *
 * - **direct**: `POST https://api.typesafe.ai/v1/systemone` with your own TypeSafe
 *   API key. Matches TypeSafe's own docs exactly — `noul`/`choice`/`score`
 *   questions, confidence inlined on the answer for choice/score.
 * - **gateway**: `experimental_evaluate` from `ai@7`, hitting the Vercel AI
 *   Gateway's `/v4/ai/evaluation-model` endpoint. Authenticates with an ordinary
 *   AI_GATEWAY_API_KEY using Vercel's system credentials — no TypeSafe account
 *   needed. Question types are `boolean`/`choice`/`score`; confidence for
 *   choice/score comes back separately under `providerMetadata.typesafe.confidence`
 *   rather than inline (boolean's `probability` doubles as its own confidence,
 *   same as direct's `noul`).
 *
 * Both were confirmed against live responses, not just documentation. Confidence
 * signals are recorded as `{ kind: "native" }` either way — a first-class
 * API-level probability, not elicited via prompting or derived from token logprobs.
 */
export class JevAdapter implements BackendAdapter {
  readonly id = "jev";
  readonly capabilities = { logprobs: false };

  constructor(private readonly config: JevAdapterConfig = {}) {}

  async decide<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<RawBackendResponse> {
    const transport = this.config.transport ?? (this.config.apiKey ? "direct" : "gateway");
    return transport === "direct"
      ? this.decideDirect(decision, input)
      : this.decideGateway(decision, input);
  }

  private async decideDirect<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<RawBackendResponse> {
    const { questions, fieldTypes } = buildQuestions(decision, this.config, "noul");

    const res = await fetch(`${this.config.baseURL ?? "https://api.typesafe.ai/v1"}/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: stateFromInput(input),
        model: this.config.model ?? "jev-latest",
        questions,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `JevAdapter (direct) request failed: ${res.status} ${res.statusText} — ${await res.text()}`,
      );
    }

    const body = (await res.json()) as DirectResponse;
    const values: Record<string, unknown> = {};
    const confidenceSignals: Record<string, ConfidenceSignal> = {};

    for (const key of decision.fieldNames) {
      const fieldKey = String(key);
      const answer = body.answers?.[fieldKey];
      if (!answer) {
        values[fieldKey] = undefined;
        confidenceSignals[fieldKey] = { kind: "none" };
        continue;
      }

      switch (fieldTypes[fieldKey]) {
        case "bool":
          values[fieldKey] = (answer.noul ?? 0) > 0.5;
          confidenceSignals[fieldKey] = { kind: "native", probability: answer.noul ?? 0 };
          break;
        case "choice":
          values[fieldKey] = answer.choice;
          confidenceSignals[fieldKey] = {
            kind: "native",
            probability: answer.confidence ?? 0,
            distribution: answer.probabilities,
          };
          break;
        case "score":
          values[fieldKey] = answer.score;
          confidenceSignals[fieldKey] = {
            kind: "native",
            probability: answer.confidence ?? 0,
            distribution: answer.probabilities,
          };
          break;
      }
    }

    return { values, confidenceSignals, model: body.model, raw: body };
  }

  private async decideGateway<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<RawBackendResponse> {
    const { questions, fieldTypes } = buildQuestions(decision, this.config, "boolean");

    const result = await evaluate({
      model: this.config.model ?? "typesafe-ai/jev",
      state: stateFromInput(input),
      questions: questions as Record<string, Experimental_EvaluationQuestion>,
    });

    const typesafeConfidence = (result.providerMetadata as Record<string, unknown> | undefined)
      ?.typesafe as { confidence?: Record<string, number> } | undefined;

    const values: Record<string, unknown> = {};
    const confidenceSignals: Record<string, ConfidenceSignal> = {};

    for (const key of decision.fieldNames) {
      const fieldKey = String(key);
      const answer = result.answers[fieldKey as keyof typeof result.answers] as
        | { type: "boolean"; probability: number }
        | { type: "choice"; choice: string; probabilities?: Record<string, number> }
        | { type: "score"; score: number; probabilities?: Record<string, number> }
        | undefined;

      if (!answer) {
        values[fieldKey] = undefined;
        confidenceSignals[fieldKey] = { kind: "none" };
        continue;
      }

      if (fieldTypes[fieldKey] === "bool" && answer.type === "boolean") {
        values[fieldKey] = answer.probability > 0.5;
        confidenceSignals[fieldKey] = { kind: "native", probability: answer.probability };
      } else if (answer.type === "choice" || answer.type === "score") {
        const reported = typesafeConfidence?.confidence?.[fieldKey];
        const distribution = answer.probabilities;
        const fallback = distribution ? Math.max(0, ...Object.values(distribution)) : 0;
        values[fieldKey] = answer.type === "choice" ? answer.choice : answer.score;
        confidenceSignals[fieldKey] = {
          kind: "native",
          probability: reported ?? fallback,
          distribution,
        };
      }
    }

    return { values, confidenceSignals, model: result.response.modelId, raw: result };
  }
}
