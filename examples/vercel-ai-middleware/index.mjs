// Requires AI_GATEWAY_API_KEY (https://vercel.com/docs/ai-gateway).
//
//   AI_GATEWAY_API_KEY=... node index.mjs
import { defineDecision, JsonlStore } from "@jevcal/core";
import { createJevCalMiddleware } from "@jevcal/vercel-ai";
import { gateway, generateObject, wrapLanguageModel } from "ai";
import { z } from "zod";

const loanDecision = defineDecision({
  name: "loan-approval",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification for this applicant"),
  }),
});

const store = new JsonlStore(".jevcal/decisions.jsonl");

const model = wrapLanguageModel({
  model: gateway("openai/gpt-4o-mini"),
  middleware: createJevCalMiddleware({ store, decision: loanDecision }),
});

const { object } = await generateObject({
  model,
  schema: loanDecision.schema,
  prompt:
    "Applicant: 3 years at current job, credit score 710, requesting $12,000 for debt consolidation, no prior defaults.",
});

console.log("Decision:", object);
console.log("\nLogged to .jevcal/decisions.jsonl — same store, same `jevcal report` command as every other adapter.");
