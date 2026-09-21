// Stress test: 10 decision domains, 1000+ real calls each, through the real
// AI Gateway. Rate-limit-safe (pacing delay + backoff), resumable (checkpoints).
//
//   node --env-file=../../.env run.mjs                # full run, 1000/domain
//   node --env-file=../../.env run.mjs --count=5       # dry run
import { readFile } from "node:fs/promises";
import { GatewayAdapter } from "@jevcal/adapter-gateway";
import { DecisionRouter, getCalibration, JsonlStore } from "@jevcal/core";
import * as academicIntegrityReview from "./domains/academic-integrity-review.mjs";
import * as codeChangeSecurityReview from "./domains/code-change-security-review.mjs";
import * as contentModeration from "./domains/content-moderation.mjs";
import * as customerChurnRetention from "./domains/customer-churn-retention.mjs";
import * as expenseReportFraud from "./domains/expense-report-fraud.mjs";
import * as insuranceClaimTriage from "./domains/insurance-claim-triage.mjs";
import * as jobApplicationScreening from "./domains/job-application-screening.mjs";
import * as loanApproval from "./domains/loan-approval.mjs";
import * as phishingEmailDetection from "./domains/phishing-email-detection.mjs";
import * as supportTicketRouting from "./domains/support-ticket-routing.mjs";
import { makeRng } from "./lib/rng.mjs";
import { runDomain } from "./lib/runner.mjs";

const domains = [
  { mod: loanApproval, field: "approved", seed: 1 },
  { mod: supportTicketRouting, field: "urgent", seed: 2 },
  { mod: contentModeration, field: "violatesPolicy", seed: 3 },
  { mod: insuranceClaimTriage, field: "autoApprove", seed: 4 },
  { mod: jobApplicationScreening, field: "advanceToInterview", seed: 5 },
  { mod: phishingEmailDetection, field: "isPhishing", seed: 6 },
  { mod: codeChangeSecurityReview, field: "requiresSecurityReview", seed: 7 },
  { mod: academicIntegrityReview, field: "flagForReview", seed: 8 },
  { mod: expenseReportFraud, field: "flagForReview", seed: 9 },
  { mod: customerChurnRetention, field: "offerRetentionDiscount", seed: 10 },
];

const countArg = process.argv.find((a) => a.startsWith("--count="));
const COUNT = countArg ? Number(countArg.split("=")[1]) : 1000;
const CONCURRENCY = 8;
const REQUEST_DELAY_MS = 120;
const STORE_PATH = ".jevcal/decisions.jsonl";

const store = new JsonlStore(STORE_PATH);
const backend = new GatewayAdapter({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  model: "openai/gpt-4o-mini",
});
const router = new DecisionRouter({ backend, store });

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s}s`;
}

async function main() {
  console.log(`Stress test: ${domains.length} domains x ${COUNT} cases = ${domains.length * COUNT} total calls`);
  console.log(`Concurrency: ${CONCURRENCY}, pacing delay: ${REQUEST_DELAY_MS}ms, store: ${STORE_PATH}\n`);

  const summaries = [];
  const overallStart = Date.now();

  for (const { mod, field, seed } of domains) {
    console.log(`\n=== ${mod.decision.name} (${COUNT} cases) ===`);
    const rng = makeRng(seed * 2654435761);
    const runResult = await runDomain({
      name: mod.decision.name,
      router,
      store,
      decision: mod.decision,
      generateCase: mod.generateCase,
      describeCase: mod.describeCase,
      groundTruth: mod.groundTruth,
      count: COUNT,
      rng,
      concurrency: CONCURRENCY,
      requestDelayMs: REQUEST_DELAY_MS,
      checkpointPath: `.jevcal/checkpoints/${mod.decision.name}.json`,
      onProgress: ({ name, done, failed, total, elapsedSec, rate }) => {
        const eta = rate > 0 ? (total - done) / rate : 0;
        console.log(
          `  [${name}] ${done}/${total} done (${failed} failed) — ${rate.toFixed(1)}/s — ` +
            `elapsed ${fmtTime(elapsedSec)} — ETA ${fmtTime(eta)}`,
        );
      },
    });

    const calibration = await getCalibration(store, { decisionName: mod.decision.name, field });
    console.log(
      `  -> done in ${fmtTime(runResult.elapsedSec)}. n=${calibration.n} ece=${calibration.ece.toFixed(3)} ` +
        `brier=${calibration.brier.toFixed(3)} failed=${runResult.failed}`,
    );

    summaries.push({
      name: mod.decision.name,
      n: calibration.n,
      failed: runResult.failed,
      ece: calibration.ece,
      brier: calibration.brier,
      elapsedSec: runResult.elapsedSec,
    });
  }

  let inputTokens = 0;
  let outputTokens = 0;
  const raw = await readFile(STORE_PATH, "utf8").catch(() => "");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.kind !== "decision") continue;
      const usage = parsed.result?.raw?.usage;
      if (usage) {
        inputTokens += usage.prompt_tokens ?? 0;
        outputTokens += usage.completion_tokens ?? 0;
      }
    } catch {
      // skip malformed line
    }
  }
  const approxCost = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.6;

  console.log("\n\n=== SUMMARY ===");
  console.log(
    `${"domain".padEnd(30)}${"n".padStart(6)}${"failed".padStart(8)}${"ece".padStart(8)}${"brier".padStart(8)}${"time".padStart(8)}`,
  );
  for (const s of summaries) {
    console.log(
      `${s.name.padEnd(30)}${String(s.n).padStart(6)}${String(s.failed).padStart(8)}` +
        `${s.ece.toFixed(3).padStart(8)}${s.brier.toFixed(3).padStart(8)}${fmtTime(s.elapsedSec).padStart(8)}`,
    );
  }
  console.log(`\nTotal elapsed: ${fmtTime((Date.now() - overallStart) / 1000)}`);
  console.log(`Total tokens: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out`);
  console.log(`Approx cost (gpt-4o-mini list pricing — verify actual in your Gateway dashboard): $${approxCost.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
