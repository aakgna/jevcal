# Contributing to jevcal

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Each package builds independently with `tsup` and tests with `vitest`. Run `pnpm --filter @jevcal/core test` (etc.) to scope to one package while iterating.

## Making a change

1. Create a branch.
2. Make your change. Add or update tests — `packages/core/src/calibration.test.ts` is a good model for what a well-scoped unit test looks like here (known-answer vectors, not just "it runs").
3. Run `pnpm changeset` and describe the change — this drives versioning and the changelog.
4. Open a PR.

## Adding a new backend adapter

This is the main way jevcal grows to cover backends its maintainers don't personally use, and the router was designed for it. A new adapter is a new package implementing `@jevcal/core`'s `BackendAdapter` interface:

```ts
interface BackendAdapter {
  id: string;
  capabilities: { logprobs: boolean };
  decide<Shape extends z.ZodRawShape>(
    decision: DecisionSchema<Shape>,
    input: DecisionInput,
  ): Promise<RawBackendResponse>;
}
```

Look at `packages/adapter-gateway` (generic OpenAI-compatible HTTP) and `packages/adapter-jev` (a bespoke typed-question API, not chat-completions) as two different shapes of "real" adapter. A few rules that keep the ecosystem consistent:

- **Never fabricate confidence.** If your backend doesn't give you a usable probability for a field, return `{ kind: "none" }` — never invent a number. Calibration metrics are the entire point of this library; a fabricated confidence signal poisons them silently.
- **Prefer `"self-reported"` as the default confidence strategy** unless your backend gives you something better (native probabilities, reliable logprobs). It's the one strategy that's portable to every backend.
- **New packages go under `packages/adapter-<name>`**, follow the existing `package.json`/`tsconfig.json`/`tsup.config.ts` shape (copy an existing adapter's as a template), and depend on `@jevcal/core` via `workspace:*`.
- If your adapter needs a peer dependency (an SDK, a client library), keep it a `peerDependency`, not a hard dependency — so installing your adapter doesn't force that dependency onto everyone else.

## Code style

Formatting and linting are handled by [Biome](https://biomejs.dev) (`pnpm lint`, `pnpm lint:fix`) — no separate ESLint/Prettier config to reason about.

## Python SDK

The `python/` directory is a separate, independent package (not built from the TS source) — see `python/README.md` for what it covers. Setup:

```bash
cd python
python3 -m venv .venv
.venv/bin/pip install -e ".[dev,postgres]"   # drop ,postgres if you don't need PostgresStore
.venv/bin/pytest -v
```

`postgres` extra tests (`tests/test_postgres_store.py`) skip automatically if no Postgres instance is reachable at `dbname=jevcal_stress_test` — they don't fail CI on a machine without Postgres. Same adapter rules as the TS side apply (never fabricate confidence, prefer `"self-reported"`/`"none"` as the portable default) — see `python/src/jevcal/adapters/jev.py` for what a real adapter looks like.
