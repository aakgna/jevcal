import type {
  BackendAdapter,
  ConfidenceSignal,
  DecisionInput,
  DecisionSchema,
  RawBackendResponse,
} from "@jevcal/core";
import type { z } from "zod";

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
}

interface RlcdFieldAnswer {
  value: unknown;
  prob?: number;
  confidence?: number;
  top_choices?: Record<string, number>;
}

export interface LocalAdapterConfig {
  /** Defaults to mlx_lm.server's default local OpenAI-compatible endpoint. */
  baseURL?: string;
  /** Model name as loaded by mlx_lm.server. */
  model?: string;
  apiKey?: string;
}

function buildPrompt<Shape extends z.ZodRawShape>(
  decision: DecisionSchema<Shape>,
  state: string,
): string {
  const shape = decision.valuesSchema.shape;
  const fieldDescriptions = decision.fieldNames
    .map((key) => {
      const fieldKey = String(key);
      const zodType = shape[fieldKey as keyof typeof shape] as z.ZodTypeAny | undefined;
      return `- ${fieldKey}: ${zodType?.description ?? "(no description provided)"}`;
    })
    .join("\n");
  return [
    "Evaluate the following fields against the given context. Respond with strict JSON only, one entry per",
    'field, each shaped as {"value": ..., "prob": <0-1>, "confidence": <0-1>, "top_choices": {...}}.',
    "",
    "Fields:",
    fieldDescriptions,
    "",
    "Context:",
    state,
  ].join("\n");
}

function stateFromInput(input: DecisionInput): string {
  if (typeof input.input === "string") return input.input;
  return input.input.map((m) => `${m.role}: ${m.content}`).join("\n");
}

/**
 * Targets harshatheg/Qwen-2.5-1B-RLCD (see docs/LOCAL_MODEL.md) — an open local
 * reproduction fine-tuned for constrained, schema-valid JSON with native per-field
 * confidence, served via mlx_lm.server's OpenAI-compatible HTTP endpoint. Unlike
 * adapter-gateway, this model emits per-field {value, prob, confidence, top_choices}
 * JSON directly as part of its fine-tuning — its own native confidence, not jevcal's
 * elicited self-reported convention — so responses are parsed against that shape
 * rather than routed through @jevcal/core's extractSelfReported helper.
 */
export class LocalAdapter implements BackendAdapter {
  readonly id = "local";
  readonly capabilities = { logprobs: false };

  constructor(private readonly config: LocalAdapterConfig = {}) {}

  async decide<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<RawBackendResponse> {
    const prompt = buildPrompt(decision, stateFromInput(input));
    const baseURL = this.config.baseURL ?? "http://127.0.0.1:8080/v1";

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey ?? "not-required"}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model ?? "harshatheg/Qwen-2.5-1B-RLCD",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(
        `LocalAdapter request failed: ${res.status} ${res.statusText} — ${await res.text()}`,
      );
    }

    const body = (await res.json()) as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Record<string, RlcdFieldAnswer>;

    const values: Record<string, unknown> = {};
    const confidenceSignals: Record<string, ConfidenceSignal> = {};

    for (const key of decision.fieldNames) {
      const fieldKey = String(key);
      const answer = parsed[fieldKey];
      if (!answer) {
        values[fieldKey] = undefined;
        confidenceSignals[fieldKey] = { kind: "none" };
        continue;
      }
      values[fieldKey] = answer.value;
      const probability = answer.confidence ?? answer.prob;
      confidenceSignals[fieldKey] =
        probability === undefined
          ? { kind: "none" }
          : { kind: "native", probability, distribution: answer.top_choices };
    }

    return { values, confidenceSignals, model: body.model ?? this.config.model, raw: body };
  }
}
