import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool, choice, randInt } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "job-application-screening",
  fields: z.object({
    advanceToInterview: z.boolean().describe("Whether this applicant should advance to an interview"),
    fitLevel: z.enum(["low", "medium", "high"]).describe("Overall fit for the role"),
  }),
});

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear advance, 1=clear reject, 2=borderline
  let yearsExperience;
  let skillMatchCount;
  let employmentGapMonths;

  if (bucket === 0) {
    yearsExperience = randInt(rng, 4, 12);
    skillMatchCount = randInt(rng, 4, 5);
    employmentGapMonths = randInt(rng, 0, 6);
  } else if (bucket === 1) {
    yearsExperience = randInt(rng, 0, 2);
    skillMatchCount = randInt(rng, 0, 2);
    employmentGapMonths = randInt(rng, 12, 36);
  } else {
    yearsExperience = choice(rng, [2, 3]);
    skillMatchCount = choice(rng, [3, 4]);
    employmentGapMonths = randInt(rng, 8, 14);
  }

  return { yearsExperience, skillMatchCount, employmentGapMonths, hasRelevantDegree: bool(rng, 0.6) };
}

export function describeCase(c) {
  return (
    "Job applicant for a mid-level role requiring 3+ years experience and matching 5 core skills: " +
    `has ${c.yearsExperience} years of relevant experience, matches ${c.skillMatchCount} of 5 required skills, ` +
    `has a ${c.employmentGapMonths}-month employment gap, holds a relevant degree: ${c.hasRelevantDegree ? "yes" : "no"}.`
  );
}

export function groundTruth(c) {
  return {
    advanceToInterview: c.skillMatchCount >= 4 && c.yearsExperience >= 3 && c.employmentGapMonths <= 12,
  };
}
