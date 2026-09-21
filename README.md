# jevcal

**Structured decisions from any LLM backend — with calibration tracking built in.**

Know not just what your model decided, but whether its confidence can be trusted.

jevcal is an open-source toolkit — TypeScript and Python — for typed, structured "decisions" (classification, routing, scoring — the kind of AI output software consumes directly, not prose a human reads). Define a decision schema once, route it to [Jev](https://docs.typesafe.ai), a generic AI gateway, or a local open reproduction, and jevcal logs every per-field probability alongside the outcome once you know it. Then it computes Expected Calibration Error (ECE), Brier score, and reliability diagrams — the standard tools for answering "when this said 90% confident, was it actually right 90% of the time?"

This README covers the TypeScript SDK. **Using Python?** See [`python/README.md`](python/README.md) — `pip install jevcal` / `uv add jevcal`, same wire format on disk, either language's tooling can read data the other logged.

TypeSafe's own docs on Jev's `confidence` field put it plainly: *"we provide `confidence` as a convenient measure that fits most use-cases, but you are never locked into our definition... test with your own data, and adjust as you observe results."* jevcal is that test.

## Quickstart

```bash
pnpm add @jevcal/core @jevcal/adapter-gateway zod
```

```ts
import { defineDecision, DecisionRouter, JsonlStore } from "@jevcal/core";
import { GatewayAdapter } from "@jevcal/adapter-gateway";
import { z } from "zod";

const loanDecision = defineDecision({
  name: "loan-approval",
  fields: z.object({
    approved: z.boolean().describe("Whether the loan should be approved"),
    riskTier: z.enum(["low", "medium", "high"]).describe("Risk classification"),
  }),
});

const store = new JsonlStore(); // .jevcal/decisions.jsonl by default
const router = new DecisionRouter({
  backend: new GatewayAdapter({
    baseURL: "https://ai-gateway.vercel.sh/v1",
    apiKey: process.env.AI_GATEWAY_API_KEY,
    model: "openai/gpt-4o-mini",
  }),
  store,
});

const result = await router.decide(loanDecision, { input: "Applicant: 710 credit score, 3yr job tenure..." });
console.log(result.fields.approved.value, result.fields.approved.probability);

// Later, once you know the real outcome:
await store.attachOutcome(result.requestId, {
  field: "approved",
  actualValue: true,
  observedAt: new Date().toISOString(),
});
```

```bash
npx @jevcal/cli report loan-approval approved
```

```
Reliability diagram: loan-approval.approved  (n=200)
0.5-0.6  | #############                     observed 0.40  predicted 0.55  (n=40)
0.6-0.7  | ################                  observed 0.50  predicted 0.65  (n=40)
0.7-0.8  | ###################               observed 0.60  predicted 0.75  (n=40)
0.8-0.9  | ######################            observed 0.70  predicted 0.85  (n=40)
0.9-1.0  | ##########################        observed 0.80  predicted 0.95  (n=40)
ECE: 0.150   Brier: 0.242
```

## Packages

| Package | What it does |
|---|---|
| [`@jevcal/core`](packages/core) | Typed decision schema (wraps Zod), router, calibration math (ECE/Brier/reliability), pluggable storage |
| [`@jevcal/adapter-gateway`](packages/adapter-gateway) | Any OpenAI-compatible chat-completions endpoint — Vercel AI Gateway, OpenAI, self-hosted |
| [`@jevcal/adapter-jev`](packages/adapter-jev) | [Typesafe AI's Jev](docs/JEV_API.md) — maps decision fields onto Jev's native choice/score/noul primitives |
| [`@jevcal/adapter-local`](packages/adapter-local) | [harshatheg/Qwen-2.5-1B-RLCD](docs/LOCAL_MODEL.md) — an open local reproduction with native per-field confidence |
| [`@jevcal/langchain`](packages/langchain) | Callback handler for LangChain.js |
| [`@jevcal/vercel-ai`](packages/vercel-ai) | Middleware for the Vercel AI SDK (`wrapLanguageModel`) |
| [`@jevcal/cli`](packages/cli) | `jevcal report` / `jevcal outcome` — attach outcomes, print calibration reports |

See [`examples/`](examples) for a runnable version of each integration path, all writing to the same store and readable by the same `jevcal report` command.

## Python

The [`python/`](python) directory is a parallel, independent SDK (not a wrapper around the TS side — see [`python/README.md`](python/README.md) for why two independent implementations sharing one wire format is the right call for a multi-language SDK). Published to TestPyPI as `jevcal`; not on the real PyPI index yet.

| Piece | Status |
|---|---|
| Decision schema (`define_decision`, Pydantic-based) | Yes |
| Calibration engine (ECE / Brier / reliability) | Yes |
| Router (`DecisionRouter`) | Yes |
| Jev adapter | Yes — direct transport only (`api.typesafe.ai`); Gateway transport not ported, see `docs/JEV_API.md` |
| Storage | `JsonlStore`, `SqliteStore`, and `PostgresStore` (optional `jevcal[postgres]` extra) — all three verified under real concurrent load (2,000 writes, 50 threads *and* separately 8 real OS processes, zero lost writes either way) |
| LangChain / Vercel AI SDK integrations, CLI | Not built — those are JS-ecosystem-specific; no Python equivalent planned unless there's demand |

## How it compares

| | jevcal | raw Jev SDK | generic observability (Langfuse/Braintrust free tier) |
|---|---|---|---|
| Backend-agnostic | yes | no | yes |
| Typed decision schema | yes (Zod) | varies | no (generic tracing) |
| Per-field probability capture | built-in | raw signals only | no |
| ECE / Brier / reliability diagrams | built-in | no | no |
| Local-first, no backend required | yes | no | no |
| Hosted dashboard | not yet | n/a | yes |

## Why this exists

Every backend jevcal talks to reports *some* form of confidence — Jev's native `confidence`, a model's self-reported score, or token logprobs. None of these are automatically trustworthy for your specific data and domain. jevcal's job is to make that testable: log what was predicted, attach what actually happened, and compute the standard calibration metrics so "90% confident" either means something or you find out it doesn't.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — in particular, adding a new `BackendAdapter` is the easiest way to extend jevcal to a backend you use.

## License

MIT — see [LICENSE](LICENSE).
