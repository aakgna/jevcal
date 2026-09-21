// Runs a batch of loan applications through a real model via the AI Gateway,
// then attaches a KNOWN ground-truth outcome for each (computed independently
// of the model's answer, by a fixed rule below) — so the resulting calibration
// report reflects something real, not n=1 noise.
//
//   node --env-file=../../.env batch.mjs
import { GatewayAdapter } from "@jevcal/adapter-gateway";
import { DecisionRouter, JsonlStore, defineDecision } from "@jevcal/core";
import { z } from "zod";

const loanDecision = defineDecision({
  name: "loan-approval",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification for this applicant"),
  }),
});

// Ground truth rule — deliberately independent of the model. Deterministic, so
// we can audit whether the model's *confidence* tracks whether it lands on the
// right side of this rule, including the borderline cases where it's genuinely close.
function groundTruthApproved({ creditScore, debtToIncome, priorDefaults }) {
  return creditScore >= 660 && debtToIncome <= 0.45 && priorDefaults === 0;
}

function describeApplicant(a) {
  return (
    `Applicant: credit score ${a.creditScore}, debt-to-income ratio ${a.debtToIncome.toFixed(2)}, ` +
    `${a.tenureYears} years at current job, ${a.priorDefaults} prior default(s), requesting $${a.loanAmount.toLocaleString()} ` +
    `for ${a.purpose}.`
  );
}

// 30 applicants: a mix of clear-approve, clear-deny, and deliberately borderline cases.
const applicants = [
  {
    creditScore: 780,
    debtToIncome: 0.18,
    tenureYears: 8,
    priorDefaults: 0,
    loanAmount: 12000,
    purpose: "home renovation",
  },
  {
    creditScore: 740,
    debtToIncome: 0.25,
    tenureYears: 5,
    priorDefaults: 0,
    loanAmount: 15000,
    purpose: "debt consolidation",
  },
  {
    creditScore: 710,
    debtToIncome: 0.3,
    tenureYears: 6,
    priorDefaults: 0,
    loanAmount: 9000,
    purpose: "medical expenses",
  },
  {
    creditScore: 695,
    debtToIncome: 0.33,
    tenureYears: 3,
    priorDefaults: 0,
    loanAmount: 11000,
    purpose: "car purchase",
  },
  {
    creditScore: 800,
    debtToIncome: 0.15,
    tenureYears: 10,
    priorDefaults: 0,
    loanAmount: 20000,
    purpose: "home renovation",
  },
  {
    creditScore: 720,
    debtToIncome: 0.4,
    tenureYears: 4,
    priorDefaults: 0,
    loanAmount: 14000,
    purpose: "debt consolidation",
  },
  {
    creditScore: 685,
    debtToIncome: 0.28,
    tenureYears: 2,
    priorDefaults: 0,
    loanAmount: 8000,
    purpose: "medical expenses",
  },
  {
    creditScore: 750,
    debtToIncome: 0.2,
    tenureYears: 7,
    priorDefaults: 0,
    loanAmount: 16000,
    purpose: "wedding",
  },
  {
    creditScore: 705,
    debtToIncome: 0.35,
    tenureYears: 3,
    priorDefaults: 0,
    loanAmount: 10000,
    purpose: "car purchase",
  },
  {
    creditScore: 670,
    debtToIncome: 0.44,
    tenureYears: 2,
    priorDefaults: 0,
    loanAmount: 7000,
    purpose: "medical expenses",
  },

  {
    creditScore: 580,
    debtToIncome: 0.55,
    tenureYears: 1,
    priorDefaults: 2,
    loanAmount: 10000,
    purpose: "debt consolidation",
  },
  {
    creditScore: 610,
    debtToIncome: 0.5,
    tenureYears: 0,
    priorDefaults: 1,
    loanAmount: 6000,
    purpose: "car purchase",
  },
  {
    creditScore: 550,
    debtToIncome: 0.6,
    tenureYears: 1,
    priorDefaults: 2,
    loanAmount: 15000,
    purpose: "home renovation",
  },
  {
    creditScore: 630,
    debtToIncome: 0.48,
    tenureYears: 2,
    priorDefaults: 1,
    loanAmount: 9000,
    purpose: "medical expenses",
  },
  {
    creditScore: 600,
    debtToIncome: 0.52,
    tenureYears: 0,
    priorDefaults: 1,
    loanAmount: 12000,
    purpose: "wedding",
  },
  {
    creditScore: 640,
    debtToIncome: 0.46,
    tenureYears: 1,
    priorDefaults: 0,
    loanAmount: 8000,
    purpose: "car purchase",
  },
  {
    creditScore: 590,
    debtToIncome: 0.58,
    tenureYears: 3,
    priorDefaults: 2,
    loanAmount: 11000,
    purpose: "debt consolidation",
  },
  {
    creditScore: 620,
    debtToIncome: 0.51,
    tenureYears: 1,
    priorDefaults: 1,
    loanAmount: 13000,
    purpose: "medical expenses",
  },
  {
    creditScore: 570,
    debtToIncome: 0.62,
    tenureYears: 0,
    priorDefaults: 2,
    loanAmount: 9500,
    purpose: "car purchase",
  },
  {
    creditScore: 615,
    debtToIncome: 0.49,
    tenureYears: 2,
    priorDefaults: 1,
    loanAmount: 7500,
    purpose: "wedding",
  },

  {
    creditScore: 660,
    debtToIncome: 0.45,
    tenureYears: 4,
    priorDefaults: 0,
    loanAmount: 10000,
    purpose: "debt consolidation",
  },
  {
    creditScore: 658,
    debtToIncome: 0.45,
    tenureYears: 4,
    priorDefaults: 0,
    loanAmount: 10000,
    purpose: "debt consolidation",
  },
  {
    creditScore: 662,
    debtToIncome: 0.46,
    tenureYears: 3,
    priorDefaults: 0,
    loanAmount: 11000,
    purpose: "car purchase",
  },
  {
    creditScore: 665,
    debtToIncome: 0.44,
    tenureYears: 5,
    priorDefaults: 0,
    loanAmount: 9000,
    purpose: "medical expenses",
  },
  {
    creditScore: 659,
    debtToIncome: 0.43,
    tenureYears: 3,
    priorDefaults: 0,
    loanAmount: 8500,
    purpose: "wedding",
  },
  {
    creditScore: 661,
    debtToIncome: 0.47,
    tenureYears: 4,
    priorDefaults: 0,
    loanAmount: 12000,
    purpose: "home renovation",
  },
  {
    creditScore: 663,
    debtToIncome: 0.45,
    tenureYears: 2,
    priorDefaults: 0,
    loanAmount: 9000,
    purpose: "car purchase",
  },
  {
    creditScore: 657,
    debtToIncome: 0.46,
    tenureYears: 6,
    priorDefaults: 0,
    loanAmount: 10500,
    purpose: "medical expenses",
  },
  {
    creditScore: 664,
    debtToIncome: 0.45,
    tenureYears: 1,
    priorDefaults: 0,
    loanAmount: 7000,
    purpose: "debt consolidation",
  },
  {
    creditScore: 656,
    debtToIncome: 0.44,
    tenureYears: 5,
    priorDefaults: 0,
    loanAmount: 13000,
    purpose: "wedding",
  },
];

const store = new JsonlStore(".jevcal/decisions.jsonl");
const router = new DecisionRouter({
  backend: new GatewayAdapter({
    baseURL: "https://ai-gateway.vercel.sh/v1",
    apiKey: process.env.AI_GATEWAY_API_KEY,
    model: "openai/gpt-4o-mini",
  }),
  store,
});

let correct = 0;
for (const [i, applicant] of applicants.entries()) {
  const result = await router.decide(loanDecision, { input: describeApplicant(applicant) });
  const truth = groundTruthApproved(applicant);

  await store.attachOutcome(result.requestId, {
    field: "approved",
    actualValue: truth,
    observedAt: new Date().toISOString(),
  });

  const hit = result.fields.approved.value === truth;
  correct += hit ? 1 : 0;
  console.log(
    `${String(i + 1).padStart(2)}/30  predicted=${String(result.fields.approved.value).padEnd(5)} ` +
      `(${(result.fields.approved.probability * 100).toFixed(0)}%)  truth=${String(truth).padEnd(5)} ` +
      `${hit ? "✓" : "✗"}`,
  );
}

console.log(
  `\n${correct}/${applicants.length} correct (${((correct / applicants.length) * 100).toFixed(0)}%)`,
);
console.log(
  "\nRun: node ../../packages/cli/dist/index.js report loan-approval approved --store .jevcal/decisions.jsonl",
);
