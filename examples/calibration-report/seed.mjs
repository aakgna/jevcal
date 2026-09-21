// Seeds a local .jevcal/decisions.jsonl with synthetic loan-approval decisions from
// a deliberately overconfident model (stated probability ~15pts above true accuracy),
// then attaches outcomes — so `jevcal report` has something real to show.
//
// No API key needed: this simulates what router.decide() + store.logDecision() would
// have produced, so the calibration-reporting path can be demoed without a live backend.
// See ../gateway-basic for an example that calls a real endpoint.
import { randomUUID } from "node:crypto";
import { defineDecision, JsonlStore } from "@jevcal/core";
import { z } from "zod";

const loanDecision = defineDecision({
  name: "loan-approval",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
  }),
});

const store = new JsonlStore(".jevcal/decisions.jsonl");

const statedProbabilities = [0.55, 0.65, 0.75, 0.85, 0.95];
const samplesPerBucket = 40;
const overconfidenceGap = 0.15;

for (const probability of statedProbabilities) {
  const trueAccuracy = probability - overconfidenceGap;
  const correctCount = Math.round(trueAccuracy * samplesPerBucket);

  for (let i = 0; i < samplesPerBucket; i++) {
    const requestId = randomUUID();
    const isCorrect = i < correctCount;

    await store.logDecision(
      {
        requestId,
        decisionName: loanDecision.name,
        schemaVersion: loanDecision.version,
        backendId: "demo",
        timestamp: new Date().toISOString(),
        fields: {
          approved: { value: true, probability, raw: { kind: "self-reported", score: probability } },
        },
        raw: {},
      },
      { input: "synthetic demo application" },
    );

    await store.attachOutcome(requestId, {
      field: "approved",
      actualValue: isCorrect, // matches predicted `true` iff isCorrect
      observedAt: new Date().toISOString(),
    });
  }
}

console.log("Seeded .jevcal/decisions.jsonl with 200 synthetic decisions.");
console.log("Now run: jevcal report loan-approval approved --store .jevcal/decisions.jsonl");
