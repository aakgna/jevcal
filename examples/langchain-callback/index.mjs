// Requires OPENAI_API_KEY (or point ChatOpenAI's `configuration.baseURL` at
// https://ai-gateway.vercel.sh/v1 with AI_GATEWAY_API_KEY instead).
//
//   OPENAI_API_KEY=... node index.mjs
import { JsonlStore, defineDecision } from "@jevcal/core";
import { JevCalCallbackHandler } from "@jevcal/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const loanDecision = defineDecision({
  name: "loan-approval",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification for this applicant"),
  }),
});

const store = new JsonlStore(".jevcal/decisions.jsonl");
const handler = new JevCalCallbackHandler(store, loanDecision);

const model = new ChatOpenAI({ model: "gpt-4o-mini" }).withStructuredOutput(loanDecision.schema);

const result = await model.invoke(
  "Applicant: 3 years at current job, credit score 710, requesting $12,000 for debt consolidation, no prior defaults.",
  { callbacks: [handler] },
);

console.log("Decision:", result);
console.log(
  "\nLogged to .jevcal/decisions.jsonl — same store, same `jevcal report` command as every other adapter.",
);
