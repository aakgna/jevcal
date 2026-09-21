import type {
  BackendAdapter,
  ConfidenceSignal,
  DecisionInput,
  DecisionSchema,
  RawBackendResponse,
} from "@jevcal/core";
import { extractSelfReported } from "@jevcal/core";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { extractFieldLogprobs } from "./logprob-extract.js";

interface ChatCompletionResponse {
  model?: string;
  choices?: {
    message?: { content?: string };
    logprobs?: { content?: { token: string; logprob: number }[] };
  }[];
}

export interface GatewayAdapterConfig {
  /** e.g. "https://ai-gateway.vercel.sh/v1" or "https://api.openai.com/v1" */
  baseURL: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

/**
 * Calls any OpenAI-compatible chat-completions endpoint (Vercel AI Gateway, OpenAI
 * directly, a self-hosted OpenAI-compatible server) via raw fetch — no SDK
 * dependency. Structured output uses `response_format: json_schema` in strict mode.
 */
export class GatewayAdapter implements BackendAdapter {
  readonly id = "gateway";
  readonly capabilities = { logprobs: true };

  constructor(protected readonly config: GatewayAdapterConfig) {}

  async decide<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<RawBackendResponse> {
    const jsonSchema = zodToJsonSchema(decision.schema);
    const useLogprobs = decision.confidenceStrategy === "logprob";
    const messages =
      typeof input.input === "string" ? [{ role: "user" as const, content: input.input }] : input.input;

    const res = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: decision.name, schema: jsonSchema, strict: true },
        },
        ...(useLogprobs ? { logprobs: true, top_logprobs: 1 } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`GatewayAdapter request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
    }

    const body = (await res.json()) as ChatCompletionResponse;
    const choice = body.choices?.[0];
    if (!choice) throw new Error("GatewayAdapter: response had no choices");

    const content: string = choice.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const fieldNames = decision.fieldNames.map(String);

    if (decision.confidenceStrategy === "self-reported") {
      const { values, confidenceSignals } = extractSelfReported(decision, parsed);
      return { values, confidenceSignals, model: body.model, raw: body };
    }

    if (useLogprobs && choice.logprobs?.content) {
      const tokens = (choice.logprobs.content as { token: string; logprob: number }[]).map((t) => ({
        token: t.token,
        logprob: t.logprob,
      }));
      const perField = extractFieldLogprobs(content, tokens, fieldNames);
      const confidenceSignals: Record<string, ConfidenceSignal> = {};
      for (const field of fieldNames) {
        const lp = perField[field];
        confidenceSignals[field] = lp
          ? { kind: "logprob", avgLogprob: lp.avgLogprob, tokenCount: lp.tokenCount }
          : { kind: "none" };
      }
      return { values: parsed, confidenceSignals, model: body.model, raw: body };
    }

    const confidenceSignals: Record<string, ConfidenceSignal> = {};
    for (const field of fieldNames) confidenceSignals[field] = { kind: "none" };
    return { values: parsed, confidenceSignals, model: body.model, raw: body };
  }
}
