# jevcal

**Structured decisions from any LLM backend — with calibration tracking built in.**

Know not just what your model decided, but whether its confidence can be trusted.

jevcal is a typed-decision and calibration-tracking toolkit for the kind of AI output software consumes directly — classification, routing, rubric-based scoring — not prose a human reads. Define a decision schema once, route it to a backend, and jevcal logs what was predicted alongside its stated confidence. Once you know the real outcome, feed that back in. jevcal computes Expected Calibration Error (ECE), Brier score, and reliability diagrams — the standard tools for answering "when this said 90% confident, was it actually right 90% of the time?"

This is the Python counterpart to `@jevcal/core` ([TypeScript source](https://github.com/aakgna/jevcal/tree/main/packages/core), not yet published to npm) — same wire format on disk, so a `.jevcal/decisions.jsonl` file written by one can be read by the other's tooling.

## Install

```bash
pip install jevcal
# or
uv add jevcal
```

Postgres support is an optional extra (adds a real dependency on `psycopg`, so it's opt-in rather than forced on everyone):

```bash
pip install "jevcal[postgres]"
```

## What's in v0.2.0

- **Decision schemas** — `define_decision`, a thin typed wrapper around a plain Pydantic model.
- **Routing** — `DecisionRouter` + a `BackendAdapter` protocol, and a real, live-verified adapter: `JevAdapter` (direct transport to `api.typesafe.ai`).
- **Storage** — three interchangeable stores, all implementing the same `log_decision` / `attach_outcome` / `get_records` shape: `JsonlStore` (zero-dependency, default), `SqliteStore` (stdlib `sqlite3`, thread-safe), `PostgresStore` (optional `[postgres]` extra, connection-pooled).
- **Calibration** — `get_calibration`, and the underlying pure math (`compute_ece`, `compute_brier_score`, `compute_reliability_diagram`) if you want to work with samples directly.

Not in this release yet: a Gateway-transport Jev adapter, an OpenAI-compatible adapter, a CLI, and async APIs.

## Quickstart

```python
from typing import Literal
from pydantic import BaseModel, Field
from jevcal import define_decision, DecisionRouter, DecisionInput, JevAdapter, JevAdapterConfig, JsonlStore, get_calibration

# A plain Pydantic model. Every field needs a `description` — it becomes the
# instruction text sent to the backend (Jev, in this example).
class LoanFields(BaseModel):
    approved: bool = Field(description="Whether the loan should be approved")
    risk_tier: Literal["low", "medium", "high"] = Field(description="Risk classification for this applicant")

# define_decision() wraps that model into a typed "decision" jevcal
# understands — gives it a name (used later to look up its logged records)
# and a confidence strategy. confidence="none" here because Jev supplies its
# own native confidence per field, so there's nothing for jevcal to add.
decision = define_decision(name="loan-approval", fields=LoanFields, confidence="none")

# JsonlStore logs every decision (and later, every attached outcome) to a
# local append-only file — .jevcal/decisions.jsonl by default. This is what
# get_calibration() reads from at the end.
store = JsonlStore()

# JevAdapter is what actually calls Jev (api.typesafe.ai) and maps your
# schema's fields onto Jev's choice/score/noul question types automatically.
adapter = JevAdapter(JevAdapterConfig(api_key="YOUR_JEV_API_KEY"))

# DecisionRouter ties a backend (the adapter) and a store together: every
# .decide() call below goes out to Jev, then gets logged to `store`
# automatically — you never call store.log_decision() yourself.
router = DecisionRouter(backend=adapter, store=store)

# Makes the real call and returns a DecisionResult. .fields is a dict keyed
# by field name; each entry holds the predicted .value and its normalized
# 0-1 .probability (already logged to the store by this point).
result = router.decide(
    decision,
    DecisionInput(input="Applicant: credit score 705, debt-to-income 0.35, no prior defaults, requesting $10,000."),
)
print(result.fields["approved"].value, result.fields["approved"].probability)

# Once you know what actually happened — days or weeks later, from your own
# system — attach_outcome() records the real-world ground truth against the
# same request_id. This is the other half of what get_calibration() needs.
from jevcal import OutcomeLabel
store.attach_outcome(
    result.request_id,
    OutcomeLabel(field="approved", actual_value=True, observed_at="2026-09-25T00:00:00Z"),
)

# Joins every logged "approved" prediction with its attached outcome and
# computes ECE / Brier score / a reliability diagram — whether the model's
# stated confidence actually matches its real accuracy. A single data point
# (as in this example) can't say anything statistically meaningful; this is
# here to complete the flow, not to demonstrate a real calibration read.
report = get_calibration(store, decision_name="loan-approval", field="approved")
print(f"n={report.n} ece={report.ece:.3f} brier={report.brier:.3f}")
```

Not using Jev, or writing your own adapter? You can always build a `DecisionResult` by hand and log it directly — see [Bringing your own backend](#bringing-your-own-backend) below.

## API reference

### Decision schema

```python
define_decision(*, name: str, fields: type[BaseModel], version: str = "1", confidence: ConfidenceStrategy = "self-reported") -> DecisionSchema
```

`fields` is a plain Pydantic model — every field **must** have a `description` (`Field(description=...)`), since that becomes the instruction text sent to a backend. `confidence` controls how per-field confidence is obtained:

| `confidence` | Behavior |
|---|---|
| `"self-reported"` (default) | Transparently adds a `${field}_confidence` companion field (0–1) to `decision.wire_model` per top-level field — portable to any backend that can follow instructions. |
| `"logprob"` | You derive confidence from token logprobs yourself (no jevcal-side field augmentation). |
| `"none"` | No augmentation — use this when the backend supplies its own native confidence (e.g. `JevAdapter`, which reports `{kind: "native"}` signals directly). |

Returns a `DecisionSchema` (frozen dataclass): `.name`, `.version`, `.confidence_strategy`, `.field_names` (`list[str]`), `.values_model` (the original, un-augmented Pydantic model — always safe to validate a cleaned value dict against), `.wire_model` (possibly augmented — pass this to a backend's structured-output call).

`confidence_field_key(field_name: str) -> str` — returns `f"{field_name}_confidence"`, the companion-key naming convention, if you need it directly.

### Routing & backends

```python
DecisionRouter(backend: BackendAdapter, store: DecisionStore | None = None)
router.decide(decision: DecisionSchema, input: DecisionInput) -> DecisionResult
```

Calls `backend.decide(decision, input)`, normalizes whatever confidence signal comes back, validates the values against `decision.values_model`, generates a fresh `request_id` (never reuses a backend-native ID, so records stay correlatable if you ever compare backends), and — if a `store` was given — logs the result automatically. `DecisionRouter` and the built-in adapters hold no per-call mutable state, so one instance is safe to share across threads (exercised directly: 300 real concurrent `JevAdapter` calls through one shared `DecisionRouter`, see `docs/TESTING.md` in the repo root).

**`JevAdapter`** — calls Typesafe AI's Jev directly (`POST https://api.typesafe.ai/v1/systemone`):

```python
JevAdapterConfig(
    api_key: str,
    base_url: str = "https://api.typesafe.ai/v1",
    model: str = "jev-latest",
    score_criteria: dict[str, list[str]] | None = None,   # required per int/float field — see below
    choice_criteria: dict[str, dict[str, str]] | None = None,
    noul_criteria: dict[str, dict[str, str]] | None = None,
)
JevAdapter(config: JevAdapterConfig)
```

Field-type mapping is automatic from your Pydantic model's annotations:

| Python field type | Jev question type | Notes |
|---|---|---|
| `bool` | `noul` | Probability the statement is true. |
| `Literal["a", "b", ...]` | `choice` | Options become criteria keys automatically. |
| `int` / `float` | `score` | **Requires `score_criteria[field_name]`** — an ordered list of 2–10 rubric level descriptions. Jev's score primitive can't infer a rubric from a bare number type; `JevAdapter` raises a clear `ValueError` if it's missing, rather than guessing. |

Only the direct transport is implemented — see `docs/JEV_API.md` in the repo root for why the Gateway transport (`experimental_evaluate` in the `ai` npm package) isn't ported yet.

**Building your own adapter** — implement the `BackendAdapter` protocol (structural typing, no inheritance required):

```python
class BackendAdapter(Protocol):
    id: str
    capabilities: dict[str, bool]
    def decide(self, decision: DecisionSchema, input: DecisionInput) -> RawBackendResponse: ...
```

Lower-level helpers used internally by `DecisionRouter`, exported in case you're writing an adapter or doing something custom:

- `normalize_confidence(signal: ConfidenceSignal) -> float | None` — converts any confidence signal to a 0–1 probability. Deliberately conservative: `NoneSignal` always normalizes to `None`, never a fabricated `1.0`.
- `extract_self_reported(decision, parsed_values: dict) -> tuple[dict, dict[str, ConfidenceSignal]]` — splits `${field}_confidence` companion keys out of a flat backend response.
- `build_field_predictions(decision, raw: RawBackendResponse) -> dict[str, FieldPrediction]` — validates + normalizes a full response into the fields dict a `DecisionResult` needs. Logs a one-time warning (via the stdlib `logging` logger named `"jevcal"`) if any field has no usable confidence signal.

### Storage

All three stores implement the same interface:

```python
store.log_decision(result: DecisionResult, input: Any) -> None
store.attach_outcome(request_id: str, outcome: OutcomeLabel) -> None
store.get_records(decision_name: str | None = None, since: str | None = None) -> list[LoggedDecisionRecord]
```

| Store | Constructor | When to use |
|---|---|---|
| `JsonlStore` | `JsonlStore(file_path: str = ".jevcal/decisions.jsonl")` | Default. Zero dependencies, human-readable, `jq`-able. Malformed lines (e.g. from a crash mid-write) are skipped with a logged warning, not fatal. |
| `SqliteStore` | `SqliteStore(file_path: str = ".jevcal/decisions.sqlite")` | Single-machine deployments needing real concurrent read/write. Uses WAL mode + `busy_timeout` + an internal lock — verified safe under 2,000 writes from 50 concurrent threads *and* separately from 8 real OS processes sharing the same file, zero lost writes either way. |
| `PostgresStore` | `PostgresStore(conninfo: str, min_size: int = 2, max_size: int = 20)` (`jevcal[postgres]` extra) | Multi-instance / production deployments. Real connection pool — every call checks out its own connection. Same concurrency verification as `SqliteStore`: 2,000 writes, 50 threads and 8 processes, zero lost writes. Stores `fields`/`input`/`metadata` as native `JSONB`. |

All three are drop-in swaps for each other — `get_calibration()` produces identical results regardless of which one is backing it, verified directly (`test_same_records_same_calibration_math_as_jsonl_store`, `test_same_records_same_calibration_math_as_other_stores`).

### Calibration

```python
get_calibration(store, *, decision_name: str, field: str, num_bins: int = 10, comparator: Callable[[Any, Any], bool] | None = None) -> CalibrationReport
```

Joins logged decisions with their attached outcomes for one field and computes calibration metrics. Records missing an outcome, or whose probability is `None` (no usable confidence signal), are excluded — not silently treated as wrong. `comparator` defaults to `==`; override it for fields needing tolerance-based correctness (e.g. a numeric field within some margin).

Returns `CalibrationReport`: `.n` (sample count actually used), `.ece`, `.brier`, `.reliability` (`list[ReliabilityBin]`).

If you're working with raw samples directly rather than through a store:

```python
compute_ece(samples: list[CalibrationSample], num_bins: int = 10) -> float
compute_brier_score(samples: list[CalibrationSample]) -> float
compute_reliability_diagram(samples: list[CalibrationSample], num_bins: int = 10) -> list[ReliabilityBin]
```

`CalibrationSample(predicted_probability: float, correct: bool)`. `ReliabilityBin`: `.bin_start`, `.bin_end`, `.avg_predicted_probability`, `.observed_frequency`, `.sample_count`.

### Types

| Type | Shape |
|---|---|
| `DecisionInput` | `.input: str \| list[dict]`, `.metadata: dict \| None` |
| `DecisionResult` | `.request_id`, `.decision_name`, `.schema_version`, `.backend_id`, `.model`, `.timestamp`, `.fields: dict[str, FieldPrediction]`, `.raw` |
| `FieldPrediction` | `.value`, `.probability: float \| None`, `.raw: ConfidenceSignal \| None` |
| `OutcomeLabel` | `.field`, `.actual_value`, `.observed_at`, `.metadata: dict \| None` |
| `LoggedDecisionRecord` | Same shape as `DecisionResult` plus `.outcomes: dict[str, OutcomeLabel]` — what `get_records()` returns |
| `RawBackendResponse` | `.values: dict`, `.confidence_signals: dict[str, ConfidenceSignal]`, `.model`, `.raw` — what a `BackendAdapter.decide()` must return |

**`ConfidenceSignal`** is a discriminated union on `.kind`:

| Kind | Fields | Meaning |
|---|---|---|
| `SelfReportedSignal` | `.score: float` | Elicited via prompting (the `${field}_confidence` convention). |
| `LogprobSignal` | `.avg_logprob: float`, `.token_count: int` | Derived from token log-probabilities. |
| `NativeSignal` | `.probability: float`, `.distribution: dict[str, float] \| None` | First-class, backend-computed probability — not elicited or derived. What `JevAdapter` reports. |
| `NoneSignal` | (none) | No usable confidence signal — `normalize_confidence` returns `None`, `get_calibration` excludes the record rather than guessing. |

## Bringing your own backend

If you're not using `JevAdapter`, you can implement `BackendAdapter` (see above) or log a hand-built `DecisionResult` directly, without going through `DecisionRouter`:

```python
from jevcal import DecisionResult, FieldPrediction, SelfReportedSignal

result = DecisionResult(
    request_id="...",
    decision_name="loan-approval",
    schema_version="1",
    backend_id="my-backend",
    timestamp="2026-09-19T00:00:00Z",
    fields={"approved": FieldPrediction(value=True, probability=0.85, raw=SelfReportedSignal(score=0.85))},
)
store.log_decision(result, input={"input": "applicant description..."})
```

## Why this exists

Every backend reports *some* form of confidence — a model's self-reported score, token logprobs, or a native API-level probability. None of these are automatically trustworthy for your specific data and domain. jevcal's job is to make that testable: log what was predicted, attach what actually happened, and compute the standard calibration metrics so "90% confident" either means something or you find out it doesn't.

## License

MIT — see [LICENSE](LICENSE).
