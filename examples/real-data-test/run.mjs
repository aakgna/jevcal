// Runs jevcal against REAL historical data instead of synthetic ground truth:
// the classic "Loan Prediction Problem" dataset (615 real loan applications,
// originally from an Analytics Vidhya hackathon, widely mirrored on GitHub/Kaggle) —
// downloaded directly from https://raw.githubusercontent.com/shrikant-temburwar/Loan-Prediction-Dataset/master/train.csv,
// no Kaggle login needed. `Loan_Status` (Y/N) is the *actual* historical outcome,
// not a rule I wrote — this is what the synthetic stress test in ../stress-test
// couldn't test.
//
//   node --env-file=../../.env run.mjs
import { readFile, writeFile } from "node:fs/promises";
import { GatewayAdapter } from "@jevcal/adapter-gateway";
import { DecisionRouter, JsonlStore, defineDecision, getCalibration } from "@jevcal/core";
import { z } from "zod";
// Reused as-is from the stress test — same rate-limited, checkpointed runner.
import { makeRng } from "../stress-test/lib/rng.mjs";
import { runDomain } from "../stress-test/lib/runner.mjs";

const decision = defineDecision({
  name: "loan-approval-real",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
  }),
});

function parseCsv(raw) {
  const [headerLine, ...lines] = raw.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i];
    });
    return row;
  });
}

function parseRow(row) {
  return {
    gender: row.Gender || "not reported",
    married: row.Married || "not reported",
    dependents: row.Dependents || "not reported",
    education: row.Education || "not reported",
    selfEmployed: row.Self_Employed || "not reported",
    applicantIncome: Number(row.ApplicantIncome) || 0,
    coapplicantIncome: Number(row.CoapplicantIncome) || 0,
    loanAmount: row.LoanAmount ? Number(row.LoanAmount) : null,
    loanTerm: row.Loan_Amount_Term ? Number(row.Loan_Amount_Term) : null,
    creditHistory: row.Credit_History === "1" ? 1 : row.Credit_History === "0" ? 0 : null,
    propertyArea: row.Property_Area || "not reported",
    approved: row.Loan_Status === "Y",
  };
}

function describeCase(c) {
  const loanAmountText =
    c.loanAmount != null ? `$${(c.loanAmount * 1000).toLocaleString()}` : "not reported";
  const loanTermText = c.loanTerm != null ? `${c.loanTerm} months` : "not reported";
  const creditHistoryText =
    c.creditHistory === 1 ? "yes" : c.creditHistory === 0 ? "no" : "not on file";
  return (
    `Loan application: ${c.gender} applicant, marital status: ${c.married}, ${c.dependents} dependents, ` +
    `education: ${c.education}, self-employed: ${c.selfEmployed}. Applicant income: $${c.applicantIncome}/month, ` +
    `co-applicant income: $${c.coapplicantIncome}/month. Requested loan amount: ${loanAmountText}, loan term: ` +
    `${loanTermText}. Credit history meets guidelines: ${creditHistoryText}. Property area: ${c.propertyArea}.`
  );
}

function groundTruth(c) {
  return { approved: c.approved };
}

const STORE_PATH = ".jevcal/decisions.jsonl";

async function main() {
  const raw = await readFile("loan_train.csv", "utf8");
  let rows = parseCsv(raw).map(parseRow);
  const countArg = process.argv.find((a) => a.startsWith("--count="));
  if (countArg) rows = rows.slice(0, Number(countArg.split("=")[1]));
  console.log(
    `Loaded ${rows.length} real loan applications from the Loan Prediction Problem dataset.`,
  );

  const store = new JsonlStore(STORE_PATH);
  const backend = new GatewayAdapter({
    baseURL: "https://ai-gateway.vercel.sh/v1",
    apiKey: process.env.AI_GATEWAY_API_KEY,
    model: "openai/gpt-4o-mini",
  });
  const router = new DecisionRouter({ backend, store });

  const runResult = await runDomain({
    name: decision.name,
    router,
    store,
    decision,
    generateCase: (_rng, idx) => rows[idx],
    describeCase,
    groundTruth,
    count: rows.length,
    rng: makeRng(42),
    concurrency: 8,
    requestDelayMs: 120,
    checkpointPath: ".jevcal/checkpoints/loan-approval-real.json",
    onProgress: ({ done, failed, total, elapsedSec, rate }) => {
      console.log(
        `  ${done}/${total} done (${failed} failed) — ${rate.toFixed(1)}/s — elapsed ${elapsedSec.toFixed(0)}s`,
      );
    },
  });

  const calibration = await getCalibration(store, {
    decisionName: decision.name,
    field: "approved",
  });
  const correct = calibration.reliability.reduce(
    (sum, b) => sum + b.observedFrequency * b.sampleCount,
    0,
  );

  console.log(
    `\nDone: ${runResult.done} calls, ${runResult.failed} failed, ${runResult.elapsedSec.toFixed(0)}s`,
  );
  console.log(
    `Accuracy: ${((correct / calibration.n) * 100).toFixed(1)}% (${Math.round(correct)}/${calibration.n})`,
  );
  console.log(
    `ECE: ${calibration.ece.toFixed(3)}   Brier: ${calibration.brier.toFixed(3)}   n=${calibration.n}`,
  );
  console.log("\nReliability:");
  for (const bin of calibration.reliability) {
    if (bin.sampleCount === 0) continue;
    console.log(
      `  ${bin.binStart.toFixed(1)}-${bin.binEnd.toFixed(1)}  predicted ${bin.avgPredictedProbability.toFixed(2)}  ` +
        `observed ${bin.observedFrequency.toFixed(2)}  (n=${bin.sampleCount})`,
    );
  }

  const baseRate = rows.filter((r) => r.approved).length / rows.length;
  console.log(
    `\n(For reference: ${(baseRate * 100).toFixed(1)}% of real applicants in this dataset were actually approved.)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
