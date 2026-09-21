import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, choice, randFloat } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "expense-report-fraud",
  fields: z.object({
    flagForReview: z.boolean().describe("Whether this expense line item should be flagged for manual review"),
    riskCategory: z.enum(["low", "medium", "high"]).describe("Fraud risk category"),
  }),
});

const policyLimits = { meals: 100, travel: 1500, equipment: 800, "office supplies": 300 };
const categories = Object.keys(policyLimits);

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear clean, 1=clear flag, 2=borderline
  const category = choice(rng, categories);
  const limit = policyLimits[category];
  let amount;
  let hasReceipt;
  let duplicateSubmission;

  if (bucket === 0) {
    amount = randFloat(rng, limit * 0.2, limit * 0.8, 2);
    hasReceipt = true;
    duplicateSubmission = false;
  } else if (bucket === 1) {
    amount = randFloat(rng, limit * 1.5, limit * 4, 2);
    hasReceipt = bool(rng, 0.3);
    duplicateSubmission = bool(rng, 0.3);
  } else {
    amount = randFloat(rng, limit * 0.9, limit * 1.1, 2);
    hasReceipt = true;
    duplicateSubmission = false;
  }

  return { category, amount, limit, hasReceipt, duplicateSubmission, submittedOnWeekend: bool(rng, 0.2) };
}

export function describeCase(c) {
  return (
    `Expense report line item: category "${c.category}", amount $${c.amount.toFixed(2)} ` +
    `(company policy limit for this category: $${c.limit}), receipt attached: ${c.hasReceipt ? "yes" : "no"}, ` +
    `flagged by the system as a possible duplicate submission: ${c.duplicateSubmission ? "yes" : "no"}, ` +
    `submitted on a weekend: ${c.submittedOnWeekend ? "yes" : "no"}.`
  );
}

export function groundTruth(c) {
  return { flagForReview: c.duplicateSubmission || !c.hasReceipt || c.amount > c.limit };
}
