// Runs the SAME decision through both real Jev transports:
//   direct  -> api.typesafe.ai, using JEV_API_KEY
//   gateway -> Vercel AI Gateway's evaluation-model interface, using AI_GATEWAY_API_KEY
//
//   node --env-file=../../.env index.mjs
import { JevAdapter } from "@jevcal/adapter-jev";
import { DecisionRouter, JsonlStore, defineDecision } from "@jevcal/core";
import { z } from "zod";

const loanDecision = defineDecision({
  name: "loan-approval-jev",
  confidence: "none", // Jev supplies native confidence directly
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification for this applicant"),
  }),
});

const input = {
  input:
    "Applicant: credit score 705, debt-to-income 0.35, 3 years at current job, no prior defaults, requesting $10,000 for a car purchase.",
};

const store = new JsonlStore(".jevcal/decisions.jsonl");

for (const [label, adapter] of [
  ["direct (api.typesafe.ai, JEV_API_KEY)", new JevAdapter({ apiKey: process.env.JEV_API_KEY })],
  ["gateway (Vercel AI Gateway, AI_GATEWAY_API_KEY)", new JevAdapter({ transport: "gateway" })],
]) {
  const router = new DecisionRouter({ backend: adapter, store });
  const result = await router.decide(loanDecision, input);
  console.log(`\n${label}`);
  console.log(`  model:     ${result.model}`);
  console.log(
    `  approved:  ${result.fields.approved.value}  (${(result.fields.approved.probability * 100).toFixed(0)}%)`,
  );
  console.log(
    `  riskTier:  ${result.fields.riskTier.value}  (${(result.fields.riskTier.probability * 100).toFixed(0)}%)`,
  );
}
