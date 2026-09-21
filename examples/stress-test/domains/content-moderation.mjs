import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, choice, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "content-moderation",
  fields: z.object({
    violatesPolicy: z
      .boolean()
      .describe("Whether this post violates community guidelines and should be removed"),
    severity: z.enum(["low", "medium", "high"]).describe("Severity if it does violate policy"),
  }),
});

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear benign, 1=clear violation, 2=borderline
  let containsSlur;
  let containsExplicitThreat;
  let targetsIndividual;
  let profanityCount;
  let spamRepeatCount;

  if (bucket === 0) {
    containsSlur = false;
    containsExplicitThreat = false;
    targetsIndividual = bool(rng, 0.3);
    profanityCount = randInt(rng, 0, 1);
    spamRepeatCount = randInt(rng, 0, 1);
  } else if (bucket === 1) {
    const mode = choice(rng, ["slur", "threat", "harassment", "spam"]);
    containsSlur = mode === "slur";
    containsExplicitThreat = mode === "threat";
    targetsIndividual = mode === "harassment" ? true : bool(rng, 0.4);
    profanityCount = mode === "harassment" ? randInt(rng, 3, 5) : randInt(rng, 0, 5);
    spamRepeatCount = mode === "spam" ? randInt(rng, 4, 6) : randInt(rng, 0, 2);
  } else {
    containsSlur = false;
    containsExplicitThreat = false;
    targetsIndividual = bool(rng, 0.5);
    profanityCount = 2; // exactly at the harassment threshold
    spamRepeatCount = choice(rng, [2, 3]); // right at the spam threshold
  }

  return {
    containsSlur,
    containsExplicitThreat,
    targetsIndividual,
    profanityCount,
    spamRepeatCount,
  };
}

export function describeCase(c) {
  return [
    "Forum post flagged for moderation review.",
    `Contains a slur targeting a protected group: ${c.containsSlur ? "yes" : "no"}.`,
    `Contains an explicit threat of violence: ${c.containsExplicitThreat ? "yes" : "no"}.`,
    `Targets one specific user by name across replies: ${c.targetsIndividual ? "yes" : "no"}.`,
    `Profanity instance count: ${c.profanityCount}.`,
    `Times this exact content has been reposted (spam repetition): ${c.spamRepeatCount}.`,
  ].join(" ");
}

export function groundTruth(c) {
  const violates =
    c.containsSlur ||
    c.containsExplicitThreat ||
    (c.targetsIndividual && c.profanityCount >= 2) ||
    c.spamRepeatCount >= 3;
  return { violatesPolicy: violates };
}
