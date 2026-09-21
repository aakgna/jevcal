import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "academic-integrity-review",
  fields: z.object({
    flagForReview: z
      .boolean()
      .describe("Whether this submission should be flagged for an academic integrity review"),
    severityTier: z.enum(["low", "medium", "high"]).describe("Severity tier if flagged"),
  }),
});

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear clean, 1=clear flag, 2=borderline
  let similarityScore;
  let citedProperly;

  if (bucket === 0) {
    similarityScore = randInt(rng, 0, 25);
    citedProperly = bool(rng, 0.8);
  } else if (bucket === 1) {
    similarityScore = randInt(rng, 55, 95);
    citedProperly = false;
  } else {
    similarityScore = randInt(rng, 36, 44);
    citedProperly = bool(rng, 0.5);
  }

  return {
    similarityScore,
    citedProperly,
    matchesKnownSource: bool(rng, 0.5),
    sectionsFlagged: randInt(rng, 1, 5),
  };
}

export function describeCase(c) {
  return (
    `Plagiarism-detection report for a submitted essay: text-similarity score ${c.similarityScore}/100 ` +
    `against existing sources. Properly cited where similarity was found: ${c.citedProperly ? "yes" : "no"}. ` +
    `Matches a known previously-submitted source: ${c.matchesKnownSource ? "yes" : "no"}. ` +
    `Number of sections flagged: ${c.sectionsFlagged}.`
  );
}

export function groundTruth(c) {
  return { flagForReview: c.similarityScore >= 40 && !c.citedProperly };
}
