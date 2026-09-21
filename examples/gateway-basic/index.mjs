// Requires AI_GATEWAY_API_KEY (https://vercel.com/docs/ai-gateway) or any
// OpenAI-compatible endpoint + key. Routes a loan-approval decision through
// a chat-completions backend, logs it, then prints its calibration report.
//
//   AI_GATEWAY_API_KEY=... node index.mjs
import { GatewayAdapter } from "@jevcal/adapter-gateway";
import { DecisionRouter, JsonlStore, defineDecision, getCalibration } from "@jevcal/core";
import { z } from "zod";

const loanDecision = defineDecision({
  name: "loan-approval",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification for this applicant"),
  }),
});

const store = new JsonlStore(".jevcal/decisions.jsonl");
const router = new DecisionRouter({
  backend: new GatewayAdapter({
    baseURL: "https://ai-gateway.vercel.sh/v1",
    apiKey: process.env.AI_GATEWAY_API_KEY,
    model: "openai/gpt-4o-mini",
  }),
  store,
});

const result = await router.decide(loanDecision, {
  input:
    "Applicant: 3 years at current job, credit score 710, requesting $12,000 for debt consolidation, no prior defaults.",
});

console.log("Decision:", result.fields.approved.value, result.fields.riskTier.value);
console.log("Confidence:", result.fields.approved.probability, result.fields.riskTier.probability);

// In a real flow, you'd attach the outcome later once you know the ground truth, e.g.
//   await store.attachOutcome(result.requestId, { field: "approved", actualValue: true, observedAt: new Date().toISOString() });
// Once enough outcomes are attached:
const report = await getCalibration(store, { decisionName: "loan-approval", field: "approved" });
console.log(
  `\nCalibration so far: n=${report.n} ece=${report.ece.toFixed(3)} brier=${report.brier.toFixed(3)}`,
);
console.log(
  "(run this a few dozen times and attach real outcomes via `jevcal outcome` to get a meaningful report)",
);
