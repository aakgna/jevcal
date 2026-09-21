import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, choice, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "insurance-claim-triage",
  fields: z.object({
    autoApprove: z
      .boolean()
      .describe("Whether this claim can be automatically approved without manual review"),
    priority: z
      .enum(["low", "medium", "high"])
      .describe("Review priority if manual review is needed"),
  }),
});

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear auto-approve, 1=clear manual review, 2=borderline
  let claimAmount;
  let priorClaims;
  let fraudFlags;
  let hasSupportingDocs;

  if (bucket === 0) {
    claimAmount = randInt(rng, 500, 15000);
    priorClaims = randInt(rng, 0, 1);
    fraudFlags = 0;
    hasSupportingDocs = true;
  } else if (bucket === 1) {
    claimAmount = randInt(rng, 40000, 150000);
    priorClaims = randInt(rng, 3, 6);
    fraudFlags = randInt(rng, 1, 3);
    hasSupportingDocs = bool(rng, 0.3);
  } else {
    claimAmount = randInt(rng, 22000, 28000);
    priorClaims = choice(rng, [2, 3]);
    fraudFlags = 0;
    hasSupportingDocs = true;
  }

  return {
    claimAmount,
    priorClaims,
    fraudFlags,
    hasSupportingDocs,
    yearsAsCustomer: randInt(rng, 0, 15),
  };
}

export function describeCase(c) {
  return (
    `Insurance claim: $${c.claimAmount.toLocaleString()} claimed, ${c.yearsAsCustomer} years as a customer, ` +
    `${c.priorClaims} prior claims filed, ${c.fraudFlags} automated fraud-detection flag(s) raised, ` +
    `supporting documentation provided: ${c.hasSupportingDocs ? "yes" : "no"}.`
  );
}

export function groundTruth(c) {
  return {
    autoApprove:
      c.hasSupportingDocs && c.fraudFlags === 0 && c.claimAmount <= 25000 && c.priorClaims <= 2,
  };
}
