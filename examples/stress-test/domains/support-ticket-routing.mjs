import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, choice, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "support-ticket-routing",
  fields: z.object({
    department: z.enum(["billing", "technical", "sales", "account"]).describe("Which team should handle this ticket"),
    urgent: z.boolean().describe("Whether this ticket needs an immediate response rather than standard queue time"),
  }),
});

const issueTemplates = {
  billing: [
    "a duplicate charge on my card",
    "my subscription renewed at the wrong price",
    "my invoice doesn't match what I was quoted",
  ],
  technical: [
    "the app crashes every time I open it",
    "my API integration keeps returning 500 errors",
    "webhooks stopped firing yesterday",
  ],
  sales: [
    "wanting to know about enterprise pricing",
    "evaluating your product against a competitor",
    "asking what's included in the Pro plan",
  ],
  account: [
    "being unable to log into their account",
    "needing to change the email on their account",
    "wanting to delete their account and data",
  ],
};

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clearly not urgent, 1=clearly urgent, 2=borderline
  const department = choice(rng, Object.keys(issueTemplates));
  const issue = choice(rng, issueTemplates[department]);
  let daysWaiting;
  let revenueImpact;
  if (bucket === 0) {
    daysWaiting = randInt(rng, 0, 1);
    revenueImpact = false;
  } else if (bucket === 1) {
    daysWaiting = randInt(rng, 4, 10);
    revenueImpact = bool(rng, 0.6);
  } else {
    daysWaiting = choice(rng, [2, 3]);
    revenueImpact = bool(rng, 0.3);
  }
  return { department, issue, daysWaiting, revenueImpact };
}

export function describeCase(c) {
  const waitPhrase = c.daysWaiting === 0 ? "just now" : `${c.daysWaiting} day(s) ago and is still unresolved`;
  const impactPhrase = c.revenueImpact ? " The customer says this is actively costing them money." : "";
  return `Support ticket: customer is ${c.issue}. They first contacted support ${waitPhrase}.${impactPhrase}`;
}

export function groundTruth(c) {
  return { urgent: c.daysWaiting >= 3 || c.revenueImpact };
}
