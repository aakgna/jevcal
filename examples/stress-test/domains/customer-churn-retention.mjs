import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, choice, randFloat, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "customer-churn-retention",
  fields: z.object({
    offerRetentionDiscount: z
      .boolean()
      .describe("Whether this customer should proactively be offered a retention discount"),
    churnRisk: z.enum(["low", "medium", "high"]).describe("Churn risk level"),
  }),
});

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear no offer, 1=clear offer, 2=borderline
  let engagementScore;
  let monthsAsCustomer;
  let planValue;

  if (bucket === 0) {
    engagementScore = randInt(rng, 60, 95);
    monthsAsCustomer = randInt(rng, 1, 24);
    planValue = randFloat(rng, 10, 100, 2);
  } else if (bucket === 1) {
    engagementScore = randInt(rng, 5, 25);
    monthsAsCustomer = randInt(rng, 8, 36);
    planValue = randFloat(rng, 25, 150, 2);
  } else {
    engagementScore = choice(rng, [38, 42]);
    monthsAsCustomer = choice(rng, [5, 6]);
    planValue = randFloat(rng, 18, 22, 2);
  }

  return {
    engagementScore,
    monthsAsCustomer,
    planValue,
    usageTrendDown: bool(rng, 0.5),
    supportTicketsLast30d: randInt(rng, 0, 5),
  };
}

export function describeCase(c) {
  return (
    `Customer account summary: engagement score ${c.engagementScore}/100, ${c.monthsAsCustomer} months as a ` +
    `customer, current plan value $${c.planValue.toFixed(2)}/month, usage trending down over the last quarter: ` +
    `${c.usageTrendDown ? "yes" : "no"}, ${c.supportTicketsLast30d} support ticket(s) in the last 30 days.`
  );
}

export function groundTruth(c) {
  return {
    offerRetentionDiscount: c.engagementScore < 40 && c.monthsAsCustomer >= 6 && c.planValue >= 20,
  };
}
