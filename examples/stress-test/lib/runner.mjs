import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCheckpoint(path) {
  try {
    const raw = await readFile(path, "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveCheckpoint(path, completedSet) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify([...completedSet]), "utf8");
}

function retryableStatus(err) {
  const match = /request failed: (\d{3})/.exec(err?.message ?? "");
  const status = match?.[1];
  return status === "429" || (status?.startsWith("5") ?? false);
}

/**
 * Runs `count` cases for one domain through `router`, attaching each case's
 * independently-computed ground truth as an outcome immediately after logging
 * the decision. Concurrent (worker pool), rate-limit-safe (per-worker pacing
 * delay + exponential backoff with jitter on 429/5xx), and resumable (a
 * checkpoint file tracks completed case indices, skipped on restart).
 */
export async function runDomain({
  name,
  router,
  store,
  decision,
  generateCase,
  describeCase,
  groundTruth,
  count,
  rng,
  concurrency = 8,
  requestDelayMs = 120,
  maxRetries = 5,
  checkpointPath,
  onProgress,
}) {
  const completed = await loadCheckpoint(checkpointPath);
  const initialDone = completed.size;
  const pending = [];
  for (let i = 0; i < count; i++) {
    if (!completed.has(i)) pending.push(i);
  }

  let failedCount = 0;
  const startTime = Date.now();
  let cursor = 0;

  async function saveAndReport() {
    await saveCheckpoint(checkpointPath, completed);
    const elapsedSec = (Date.now() - startTime) / 1000;
    const rate = elapsedSec > 0 ? (completed.size - initialDone) / elapsedSec : 0;
    onProgress?.({ name, done: completed.size, failed: failedCount, total: count, elapsedSec, rate });
  }

  async function worker() {
    while (cursor < pending.length) {
      const idx = pending[cursor++];
      const caseData = generateCase(rng, idx);
      const state = describeCase(caseData);
      const truth = groundTruth(caseData);

      let attempt = 0;
      // biome-ignore lint/correctness/noConstantCondition: retry loop, exits via break
      while (true) {
        try {
          const result = await router.decide(decision, { input: state });
          for (const [field, value] of Object.entries(truth)) {
            await store.attachOutcome(result.requestId, {
              field,
              actualValue: value,
              observedAt: new Date().toISOString(),
            });
          }
          completed.add(idx);
          break;
        } catch (err) {
          attempt++;
          if (!retryableStatus(err) || attempt > maxRetries) {
            failedCount++;
            console.error(`[${name}] case ${idx} failed permanently: ${err.message}`);
            break;
          }
          const backoff = Math.min(1000 * 2 ** attempt, 15000) + Math.random() * 300;
          await sleep(backoff);
        }
      }

      if (completed.size % 50 === 0) await saveAndReport();
      await sleep(requestDelayMs);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pending.length) || 1 }, () => worker());
  await Promise.all(workers);
  await saveAndReport();

  return {
    name,
    done: completed.size,
    failed: failedCount,
    total: count,
    elapsedSec: (Date.now() - startTime) / 1000,
  };
}
