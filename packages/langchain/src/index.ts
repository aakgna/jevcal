import { randomUUID } from "node:crypto";
import { buildFieldPredictions, extractSelfReported } from "@jevcal/core";
import type { ConfidenceSignal, DecisionSchema, DecisionStore } from "@jevcal/core";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";

/**
 * Logs structured decisions produced through LangChain.js (e.g. a model wrapped
 * with `.withStructuredOutput(decision.schema)`) to a jevcal DecisionStore.
 *
 * Known risk, flagged rather than papered over: LangChain's `withStructuredOutput`
 * doesn't reliably surface per-token logprobs through callback metadata across every
 * provider. This handler only supports "self-reported" and "none" confidence
 * strategies — requesting "logprob" degrades to "none" with a one-time warning,
 * since there's no dependable logprob signal available at this integration point.
 */
export class JevCalCallbackHandler extends BaseCallbackHandler {
  name = "jevcal_callback_handler";
  private warnedLogprobUnsupported = false;

  constructor(
    private readonly store: DecisionStore,
    private readonly decision: DecisionSchema,
  ) {
    super();
  }

  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const text = output.generations[0]?.[0]?.text;
    if (!text) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // not structured JSON output for this decision — nothing to log
    }

    if (this.decision.confidenceStrategy === "logprob" && !this.warnedLogprobUnsupported) {
      this.warnedLogprobUnsupported = true;
      console.warn(
        '[jevcal] JevCalCallbackHandler does not support confidence: "logprob" — LangChain.js callbacks don\'t ' +
          "reliably expose per-token logprobs across providers. Falling back to no confidence signal for this run.",
      );
    }

    const { values, confidenceSignals } =
      this.decision.confidenceStrategy === "self-reported"
        ? extractSelfReported(this.decision, parsed)
        : {
            values: parsed,
            confidenceSignals: Object.fromEntries(
              this.decision.fieldNames.map((f) => [
                String(f),
                { kind: "none" } as ConfidenceSignal,
              ]),
            ),
          };

    const fields = buildFieldPredictions(this.decision, { values, confidenceSignals, raw: output });
    const requestId = randomUUID(); // jevcal-generated, not LangChain's runId — keeps requestIds correlatable across backends

    await this.store.logDecision(
      {
        requestId,
        decisionName: this.decision.name,
        schemaVersion: this.decision.version,
        backendId: "langchain",
        timestamp: new Date().toISOString(),
        fields,
        raw: output,
      },
      { input: text, metadata: { langchainRunId: runId } },
    );
  }
}
