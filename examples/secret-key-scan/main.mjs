// Dogfooding test: use jevcal + real Jev to classify whether a file contains
// an EXPOSED (hardcoded/literal) secret key, vs. only a reference to one via
// an environment variable — not "does this file mention a key," specifically
// "is there a literal value sitting in the text."
//
// Ground truth for the real files below comes from the manual regex-based
// security audit already done on this exact repo (confirmed clean, zero
// hardcoded secrets anywhere) — so this doubles as an independent,
// LLM-based cross-check of that audit, not just a synthetic toy test.
// Synthetic cases add genuine true/false variation (the real files are all
// negatives) with clearly fake, non-functional secret-shaped strings.
//
//   node --env-file=../../.env main.mjs
import { readFile } from "node:fs/promises";
import { JevAdapter } from "@jevcal/adapter-jev";
import { DecisionRouter, JsonlStore, defineDecision, getCalibration } from "@jevcal/core";
import { z } from "zod";

const decision = defineDecision({
  name: "secret-key-scan",
  confidence: "none", // Jev supplies native confidence
  fields: z.object({
    hasExposedSecret: z
      .boolean()
      .describe(
        "Whether this file contains a hardcoded, literal secret key, API token, password, or credential " +
          "value written directly in the text — as opposed to only referencing one indirectly via an " +
          "environment variable (os.environ, process.env, import.meta.env, ${{ secrets.X }} in GitHub " +
          'Actions, etc.), an empty value, or an obvious placeholder string like "YOUR_API_KEY_HERE". ' +
          "Only count a genuine literal secret value as exposed.",
      ),
  }),
});

// Real files from this repo. Every one is a confirmed negative — already
// manually audited (grep across full git history + a fresh remote clone) —
// used here as real-world validation, not just synthetic cases.
const realFiles = [
  "../../README.md",
  "../../.env.example",
  "../../.github/workflows/ci.yml",
  "../../.github/workflows/release.yml",
  "../../packages/adapter-jev/src/index.ts",
  "../../packages/core/src/router.ts",
  "../../examples/gateway-basic/index.mjs",
  "../../python/src/jevcal/adapters/jev.py",
  "../../python/examples/jev-basic/main.py",
];

// Synthetic cases — clearly fake, non-functional secret-shaped strings kept
// only as in-memory strings here, never written to disk. Gives genuine
// true/false variation plus a couple of deliberately tricky negatives.
const syntheticCases = [
  {
    label: "hardcoded-openai-style-key",
    truth: true,
    content:
      'const client = new OpenAI({ apiKey: "sk-proj-aB3dEf6HiJkLmNoPqRsTuVwXyZ1234567890abcdefghij" });',
  },
  {
    label: "hardcoded-github-token",
    truth: true,
    content: 'headers: { Authorization: "Bearer ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD" }',
  },
  {
    label: "hardcoded-env-file-style",
    truth: true,
    content:
      "AI_GATEWAY_API_KEY=vck_live_9f8e7d6c5b4a39281706f5e4d3c2b1a0abcdef1234567890\n" +
      "JEV_API_KEY=ts_live_reallylongfakesecretvalue1234567890",
  },
  {
    label: "hardcoded-python-key",
    truth: true,
    content: 'client = OpenAI(api_key="sk-abcd1234efgh5678ijkl9012mnop3456")',
  },
  {
    label: "env-var-reference-js",
    truth: false,
    content:
      "const apiKey = process.env.AI_GATEWAY_API_KEY;\nconst adapter = new GatewayAdapter({ apiKey });",
  },
  {
    label: "env-var-reference-python",
    truth: false,
    content:
      'import os\napi_key = os.environ["JEV_API_KEY"]\nadapter = JevAdapter(JevAdapterConfig(api_key=api_key))',
  },
  {
    label: "empty-env-placeholder",
    truth: false,
    content: "# .env.example\nAI_GATEWAY_API_KEY=\nJEV_API_KEY=\nOPENAI_API_KEY=",
  },
  {
    label: "obvious-placeholder-string",
    truth: false,
    content: 'JevAdapter(JevAdapterConfig(api_key="YOUR_JEV_API_KEY"))',
  },
  {
    label: "github-actions-secrets-reference",
    truth: false,
    content:
      "env:\n  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
  },
  {
    label: "comment-mentioning-key-no-value",
    truth: false,
    content:
      "// Remember to set your API key via the AI_GATEWAY_API_KEY environment variable before running this.",
  },
];

const store = new JsonlStore(".jevcal/decisions.jsonl");
const adapter = new JevAdapter({ apiKey: process.env.JEV_API_KEY });
const router = new DecisionRouter({ backend: adapter, store });

const rows = [];

async function scan(label, content, truth) {
  const truncated = content.slice(0, 4000); // keep prompts reasonable
  const result = await router.decide(decision, { input: `Filename: ${label}\n\n${truncated}` });
  const predicted = result.fields.hasExposedSecret.value;
  const probability = result.fields.hasExposedSecret.probability;
  await store.attachOutcome(result.requestId, {
    field: "hasExposedSecret",
    actualValue: truth,
    observedAt: new Date().toISOString(),
  });
  rows.push({ label, truth, predicted, probability });
  const hit = predicted === truth ? "✓" : "✗ MISMATCH";
  console.log(
    `${hit.padEnd(11)} truth=${String(truth).padEnd(5)} predicted=${String(predicted).padEnd(5)} ` +
      `(${(probability * 100).toFixed(0)}%)  ${label}`,
  );
}

for (const filePath of realFiles) {
  const content = await readFile(new URL(filePath, import.meta.url), "utf8");
  await scan(filePath, content, false);
}

for (const { label, truth, content } of syntheticCases) {
  await scan(label, content, truth);
}

const correct = rows.filter((r) => r.predicted === r.truth).length;
console.log(`\n${correct}/${rows.length} correct`);

const report = await getCalibration(store, {
  decisionName: "secret-key-scan",
  field: "hasExposedSecret",
});
console.log(
  `\nCalibration: n=${report.n} ece=${report.ece.toFixed(3)} brier=${report.brier.toFixed(3)}`,
);
console.log("\nReliability:");
for (const bin of report.reliability) {
  if (bin.sampleCount === 0) continue;
  console.log(
    `  ${bin.binStart.toFixed(1)}-${bin.binEnd.toFixed(1)}  predicted ${bin.avgPredictedProbability.toFixed(2)}  ` +
      `observed ${bin.observedFrequency.toFixed(2)}  (n=${bin.sampleCount})`,
  );
}

const mismatches = rows.filter((r) => r.predicted !== r.truth);
if (mismatches.length > 0) {
  console.log("\nMismatches:");
  for (const m of mismatches) {
    console.log(
      `  ${m.label}: predicted ${m.predicted} (${(m.probability * 100).toFixed(0)}%), truth ${m.truth}`,
    );
  }
}
