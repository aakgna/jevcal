import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, choice, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "code-change-security-review",
  fields: z.object({
    requiresSecurityReview: z
      .boolean()
      .describe("Whether this code change requires a manual security review before merge"),
    severityScore: z
      .number()
      .min(0)
      .max(10)
      .describe("Estimated security severity of this change, 0 (none) to 10 (critical)"),
  }),
});

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear no-review, 1=clear review, 2=borderline
  let touchesAuthCode;
  let touchesPaymentCode;
  let addsNewDependency;
  let linesChanged;

  if (bucket === 0) {
    touchesAuthCode = false;
    touchesPaymentCode = false;
    addsNewDependency = bool(rng, 0.3);
    linesChanged = randInt(rng, 5, 150);
  } else if (bucket === 1) {
    touchesAuthCode = bool(rng, 0.5);
    touchesPaymentCode = touchesAuthCode ? bool(rng, 0.5) : true;
    addsNewDependency = bool(rng, 0.5);
    linesChanged = randInt(rng, 100, 800);
  } else {
    touchesAuthCode = false;
    touchesPaymentCode = false;
    addsNewDependency = true;
    linesChanged = choice(rng, [180, 220]);
  }

  return {
    touchesAuthCode,
    touchesPaymentCode,
    addsNewDependency,
    linesChanged,
    hasTests: bool(rng, 0.7),
  };
}

export function describeCase(c) {
  return (
    `Pull request summary: modifies authentication code: ${c.touchesAuthCode ? "yes" : "no"}. ` +
    `Modifies payment-processing code: ${c.touchesPaymentCode ? "yes" : "no"}. ` +
    `Adds a new third-party dependency: ${c.addsNewDependency ? "yes" : "no"}. ` +
    `Lines changed: ${c.linesChanged}. Includes tests: ${c.hasTests ? "yes" : "no"}.`
  );
}

export function groundTruth(c) {
  return {
    requiresSecurityReview:
      c.touchesAuthCode || c.touchesPaymentCode || (c.addsNewDependency && c.linesChanged > 200),
  };
}
