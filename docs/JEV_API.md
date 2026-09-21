# Jev / TypeSafe AI — verified API reference

Working notes for `@jevcal/adapter-jev` (TypeScript). Two transports exist and **both have been verified against live responses**, not just documentation — see `docs/TESTING.md` for the actual runs. Originally written from https://docs.typesafe.ai alone (2026-09-18); corrected 2026-09-19 after getting real credentials for both paths and finding the docs site's shape doesn't exactly match either transport's real response.

Python's `JevAdapter` (`python/src/jevcal/adapters/jev.py`) implements only the **direct transport** section below — the Gateway transport section is TS-only for now, since it depends on the `ai` npm package's `experimental_evaluate()`, which has no Python equivalent.

## What Jev is

TypeSafe AI's flagship "System One" model. Not a text-generation model — the Gateway's real `/v1/models` listing shows `"type": "evaluation"`, `context_window: 0`, `max_tokens: 0`, `"supported_specifications": ["v4"]` (a distinct API version from the chat-completions models on the same Gateway). It answers typed *questions* against a *state* (some text/context) and returns structured values with native probability, evaluated independently and in parallel.

Pricing (from the live Gateway listing): `$0.042 / 1M input tokens`, `$0 / output token`.

## Two transports, both real

### 1. Direct — `POST https://api.typesafe.ai/v1/systemone`

Requires your own TypeSafe API key. Confirmed via `curl` with a real `JEV_API_KEY`:

```
Authorization: Bearer <JEV_API_KEY>
Content-Type: application/json
```

Request body **includes a `model` field** — easy to miss, it's not obvious from the primitive-level docs pages, only from the quickstart's full example:
```json
{ "state": "context text", "model": "jev-latest", "questions": { "key1": { "type": "...", ... } } }
```

Response — matches TypeSafe's own docs exactly, confidence inlined per answer:
```json
{ "model": "jev-1.13.0", "answers": { "key1": { "type": "...", ... } }, "usage": { "input_tokens": 388, "output_tokens": 56 } }
```

Question types: `choice`, `score`, **`noul`** (TypeSafe's own name for the boolean/truth primitive).

### 2. Gateway — `experimental_evaluate` (`ai@7`)

No TypeSafe account needed — authenticates with an ordinary `AI_GATEWAY_API_KEY` (or Vercel OIDC), and as of this writing is billed through **Vercel's system credentials at $0 cost** (confirmed in a live response's `providerMetadata.gateway.cost: "0"`, with `marketCost` showing what it would otherwise have been). Hits the Gateway's real `/v4/ai/evaluation-model` endpoint under the hood.

**Only in `ai@7+`.** `ai@6.0.286` (what `@jevcal/vercel-ai` targets) has no `experimental_evaluate` export at all — confirmed by grepping the installed package's own `.d.ts`, not assumed. `@jevcal/adapter-jev` therefore has its own, newer peer dependency (`ai >=7.0.0`) independent of `@jevcal/vercel-ai`'s (`ai >=5.0.0`).

```ts
import { experimental_evaluate as evaluate } from "ai";
const result = await evaluate({ model: "typesafe-ai/jev", state, questions });
```

Question types: `choice`, `score`, **`boolean`** — the SDK's own generic cross-provider naming, not TypeSafe's `noul`. Real request/response types live in `@ai-sdk/provider`'s source (`src/evaluation-model/v4/evaluation-model-v4-question.ts`), not just its bundled `.d.ts`.

**Confidence isn't inlined here.** Unlike the direct transport, the Gateway's `evaluate()` response has no `confidence` field on the `choice`/`score` answers themselves — TypeSafe's confidence number instead comes back separately, under `result.providerMetadata.typesafe.confidence`, keyed by field name. `boolean` answers have no separate confidence entry there because their `probability` already doubles as confidence (same reasoning as `noul` on the direct transport). `adapter-jev` falls back to the top value in the answer's `probabilities` distribution if that metadata is ever absent.

## Field-type mapping used by `adapter-jev`

| Zod field type | Direct transport | Gateway transport |
|---|---|---|
| `z.boolean()` | `noul` — `value = noul > 0.5`, `probability = noul` | `boolean` — same logic, field named `probability` directly |
| `z.enum([...])` | `choice` — `confidence` inline on the answer | `choice` — confidence from `providerMetadata.typesafe.confidence` |
| `z.number()` | `score` — **requires `scoreCriteria[fieldName]`** (ordered rubric, 2-10 levels) in adapter config; can't be inferred from a bare number type | same, `score` |

`.describe()` on the Zod field becomes the question's `instructions` in both transports — required; the adapter throws a clear error if it's missing.

## Choosing a transport

`JevAdapter` defaults to `"direct"` if `apiKey` is set in its config, else `"gateway"` — or set `transport` explicitly. Both were run side by side against the same decision in `examples/jev-basic` and returned closely agreeing probabilities (80% vs 81%, 63% vs 62%), which is itself a reasonable sanity check that both paths hit the same underlying model.

## Confidence vs. probability (TypeSafe's own framing)

TypeSafe is explicit that `confidence` is a convenience metric, not a validated calibration guarantee: *"We provide `confidence` as a convenient measure that fits most use-cases, but you are never locked into our definition."* and recommends users *"test with your own data, and adjust as you observe results."* No formal calibration methodology is documented on their side.

This is directly on-thesis for jevcal: TypeSafe's own docs say don't trust `confidence` blindly — that's exactly what jevcal's ECE/Brier/reliability-diagram machinery is for.

Maps to `ConfidenceSignal` as `{ kind: "native", probability, distribution? }` on both transports — a kind distinct from `self-reported` (elicited via prompting) and `logprob` (derived from token probabilities), since this is a first-class API-level probability the backend itself computes.

## What was wrong in the first version of this doc

Worth keeping as a record, not just quietly fixing: the first pass at this adapter was built entirely from reading https://docs.typesafe.ai's rendered pages, with no real credentials to check against, and got two things wrong as a result — it assumed the Gateway path required an unverified `experimental_evaluate` signature and left it unimplemented as a stub, and it didn't know the direct API's request body needs a `model` field. Both were caught by actually getting credentials and calling the real endpoints, not by reading harder.
