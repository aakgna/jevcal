import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { choice, randFloat, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "loan-approval",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification for this applicant"),
  }),
});

const purposes = [
  "debt consolidation",
  "medical expenses",
  "car purchase",
  "home renovation",
  "wedding",
];

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear approve, 1=clear deny, 2=borderline
  let creditScore;
  let debtToIncome;
  let priorDefaults;
  if (bucket === 0) {
    creditScore = randInt(rng, 700, 820);
    debtToIncome = randFloat(rng, 0.1, 0.35);
    priorDefaults = 0;
  } else if (bucket === 1) {
    creditScore = randInt(rng, 500, 620);
    debtToIncome = randFloat(rng, 0.48, 0.65);
    priorDefaults = randInt(rng, 1, 3);
  } else {
    creditScore = randInt(rng, 645, 675);
    debtToIncome = randFloat(rng, 0.4, 0.48);
    priorDefaults = 0;
  }
  return {
    creditScore,
    debtToIncome,
    tenureYears: randInt(rng, 0, 10),
    priorDefaults,
    loanAmount: randInt(rng, 5, 30) * 1000,
    purpose: choice(rng, purposes),
  };
}

export function describeCase(c) {
  return (
    `Applicant: credit score ${c.creditScore}, debt-to-income ratio ${c.debtToIncome.toFixed(2)}, ` +
    `${c.tenureYears} years at current job, ${c.priorDefaults} prior default(s), requesting ` +
    `$${c.loanAmount.toLocaleString()} for ${c.purpose}.`
  );
}

export function groundTruth(c) {
  return { approved: c.creditScore >= 660 && c.debtToIncome <= 0.45 && c.priorDefaults === 0 };
}
