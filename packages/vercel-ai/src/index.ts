import { randomUUID } from "node:crypto";
import { buildFieldPredictions, extractSelfReported } from "@jevcal/core";
import type { ConfidenceSignal, DecisionSchema, DecisionStore } from "@jevcal/core";
import type { LanguageModelMiddleware } from "ai";

export interface JevCalMiddlewareConfig {
  store: DecisionStore;
  decision: DecisionSchema;
}

/**
 * Logs structured decisions produced through the Vercel AI SDK (e.g.
 * `generateObject({ model, schema: decision.schema })`) to a jevcal DecisionStore.
 * Slots in via `wrapLanguageModel`, one call below `generateObject`/`generateText`,
 * so it sees the same underlying model response regardless of which AI SDK function
 * is used on top.
 *
 * Uses `LanguageModelMiddleware`, the AI SDK's version-stable middleware alias
 * (currently backed by LanguageModelV3Middleware) rather than importing a
 * version-suffixed type directly, so this package doesn't need a new release every
 * time the AI SDK bumps its internal spec version.
 */
export function createJevCalMiddleware(config: JevCalMiddlewareConfig): LanguageModelMiddleware {
  const { store, decision } = config;

  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();

      const text = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch {
        return result; // not structured JSON for this decision — nothing to log
      }

      const { values, confidenceSignals } =
        decision.confidenceStrategy === "self-reported"
          ? extractSelfReported(decision, parsed)
          : {
              values: parsed,
              confidenceSignals: Object.fromEntries(
                decision.fieldNames.map((f) => [String(f), { kind: "none" } as ConfidenceSignal]),
              ),
            };

      const fields = buildFieldPredictions(decision, { values, confidenceSignals, raw: result });
      const requestId = randomUUID();

      await store.logDecision(
        {
          requestId,
          decisionName: decision.name,
          schemaVersion: decision.version,
          backendId: "vercel-ai",
          timestamp: new Date().toISOString(),
          fields,
          raw: result,
        },
        { input: JSON.stringify(params.prompt ?? {}) },
      );

      return {
        ...result,
        providerMetadata: { ...result.providerMetadata, jevcal: { requestId } },
      };
    },
  };
}
