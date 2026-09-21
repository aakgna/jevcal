# Manually verifying jevcal end-to-end

Notes from actually running the SDK, not just typechecking it. Three tiers, each building on the last.

## Tier 1 — synthetic data, no API key

```bash
cd examples/calibration-report
node seed.mjs
node ../../packages/cli/dist/index.js report loan-approval approved
```

`seed.mjs` writes 200 synthetic decisions directly to a `JsonlStore` — a model deliberately made to state ~15 points more confidence than its true accuracy at every probability level — then attaches outcomes for each. This exercises the full store → calibration math → CLI rendering path without needing a backend.

**Result:**
```
ECE: 0.150   Brier: 0.242
```
Recovered the exact 0.15 overconfidence gap that was seeded — confirms the calibration math (`computeECE`, `computeBrierScore`, `computeReliabilityDiagram`) is correct, not just plausible-looking.

## Tier 2 — one real decision

```bash
cd examples/gateway-basic
node --env-file=../../.env index.mjs
```

Routes one loan application through `@jevcal/adapter-gateway` to `openai/gpt-4o-mini` via the Vercel AI Gateway (`AI_GATEWAY_API_KEY` from `.env`). Confirms the real network path, response parsing, and self-reported confidence extraction all work against a live model — but a single decision (`n=1`) can't say anything statistical yet.

**Result:** `approved: true (85% confidence)`, `riskTier: medium (80% confidence)` — logged to `.jevcal/decisions.jsonl`.

## Tier 3 — a batch with known ground truth

```bash
node --env-file=../../.env batch.mjs
node ../../packages/cli/dist/index.js report loan-approval approved --svg gateway-reliability.svg
```

`batch.mjs` runs 30 synthetic loan applicants — a mix of clear-approve, clear-deny, and deliberately borderline cases (credit score / debt-to-income right at the approval threshold) — through the same real model. Each applicant's true outcome comes from a fixed rule (`groundTruthApproved`) defined independently of the model, so grading isn't circular.

**Result:** 25/30 correct (83%).
```
0.7-0.8  | ##################                observed 0.57  predicted 0.74  (n=7)
0.8-0.9  | ############################      observed 0.88  predicted 0.84  (n=17)
0.9-1.0  | ################################  observed 1.00  predicted 0.94  (n=6)
ECE: 0.077   Brier: 0.119
```

The finding: `gpt-4o-mini` is well-calibrated overall, but the miscalibration isn't uniform — it's concentrated in the 0.7–0.8 confidence bucket, which is exactly the deliberately-borderline applicants. Every one of the 5 misses falls there; the model states ~74% confidence but is only right 57% of the time on those specific cases, while it's actually slightly *under*confident on the clear-cut ones. That localized pattern — not just an average ECE — is the kind of thing this tool exists to surface, and it only shows up once you have enough volume with real outcomes attached.

## Tier 4 — Jev, for real, both transports

Once real credentials arrived (`JEV_API_KEY` for TypeSafe directly, plus the existing `AI_GATEWAY_API_KEY`), `@jevcal/adapter-jev` got a real correction, not just a real test: the version built from reading docs.typesafe.ai alone had the Gateway path left as an unverified stub and was missing a required `model` field on the direct transport's request body. Both were caught empirically — first by installing `ai@latest` in an isolated scratch dir and reading its actual TypeScript source (`experimental_evaluate` only exists in `ai@7`, not the `ai@6` the rest of the SDK targets), then by `curl`-ing the direct API and diffing the real response against what had been assumed.

```bash
cd examples/jev-basic
node --env-file=../../.env index.mjs
```

Runs the same decision through both transports back to back:

```
direct (api.typesafe.ai, JEV_API_KEY)
  model:     jev-1.13.0
  approved:  true  (80%)
  riskTier:  low  (63%)

gateway (Vercel AI Gateway, AI_GATEWAY_API_KEY)
  model:     typesafe-ai/jev
  approved:  true  (81%)
  riskTier:  low  (62%)
```

Close agreement between the two independent transports is itself a useful sanity check — full details, including the exact response shapes and the `providerMetadata.typesafe.confidence` discovery, are in `docs/JEV_API.md`.

## Python SDK

Independent implementation, same wire format (verified, see below) — not a wrapper around the TS side.

**Published, and installed from the real index, not a local file**: `pip install -i https://test.pypi.org/simple/ jevcal` into a throwaway venv actually pulls from TestPyPI's real index and works. Confirmed via TestPyPI's own API that the package exists there before testing the install, not just assumed from a successful `uv publish` exit code.

**Cross-language wire format, verified for real**: pointed a freshly-installed Python `JsonlStore`/`get_calibration` at the actual 20,082-line file the TypeScript stress test (below) produced, with zero modification. It reproduced bit-identical ECE/Brier numbers to what the TS CLI reported. A Python implementation, independently written, reading data it never wrote, landing on identical results.

**Real Jev call**: `JevAdapter` (direct transport) against real `JEV_API_KEY`, matched the TS adapter's numbers closely (80%/64% confidence vs TS's 80%/63%).

**Concurrency stress test**: found a real bug during planning, before any test ran — `SqliteStore` shared one `sqlite3.Connection` with Python's default `check_same_thread=True`, which would crash instantly under threading, before revealing anything about actual race conditions. Fixed with `check_same_thread=False` + WAL mode + `busy_timeout` + a `threading.Lock`. Built `PostgresStore` (`psycopg`, connection-pooled) against a real local Postgres 15 instance. Ran 300 real concurrent Jev calls per store (600 total, 15 workers, ~42/s) plus a 2,000-write storage-only hammer test per store via both `ThreadPoolExecutor` (50 threads) and real `multiprocessing` (8 separate OS processes). Verified independently via raw `psql`/`sqlite3` queries, bypassing jevcal's own code entirely: 4,300 records per store, zero lost writes, zero duplicate IDs, zero orphaned outcomes, both stores.

## What this leaves unverified

- `@jevcal/adapter-local` — no MLX/`mlx_lm.server` instance running locally; typechecked and built, not exercised against the actual model.
- `@jevcal/langchain` and `@jevcal/vercel-ai` — confirmed to resolve and fail cleanly at the auth boundary with real credentials missing at the time; not yet re-run now that `OPENAI_API_KEY`/`AI_GATEWAY_API_KEY` are available.
- Python: no Gateway-transport Jev adapter, no OpenAI-compatible adapter, no CLI, no async API — see `python/README.md`'s "What's in v0.2.0" for the full scope line. Not published to the real PyPI index, only TestPyPI.
