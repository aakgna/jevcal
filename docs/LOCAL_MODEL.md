# Local open-reproduction target — harshatheg/Qwen-2.5-1B-RLCD

Working notes for `@jevcal/adapter-local`. Source: https://huggingface.co/harshatheg/Qwen-2.5-1B-RLCD, fetched 2026-09-19.

## What it actually is

Not a generic chat model served however we like — it's purpose-built to reproduce Jev-style structured decisions locally:

- Base: fine-tune of `Qwen/Qwen2.5-1.5B-Instruct`.
- "RLCD" = Reinforcement Learning for Constrained Decoding — trained for constrained JSON output with guaranteed schema validity, not free-form text.
- Optimized for **Apple Silicon via MLX** (`mlx-lm` package), using KV-cache broadcasting to evaluate fields in parallel rather than token-by-token — 5.6x–7.0x latency reduction over standard autoregressive decoding, per the model card. This parallel-per-field evaluation is conceptually close to how Jev evaluates each question independently.
- **Natively emits per-field confidence**: response shape includes `value`, `prob`, `confidence`, and `top_choices` (a normalized distribution over candidate options) per field — this is the model's own fine-tuned output convention, not something elicited via jevcal's `${field}_confidence` prompting convention.
- Ships example JSON presets for fintech fraud detection, code security audit, and support triage — ready-made decision-shaped use cases.
- No GGUF/safetensors files called out in the fetched card — Ollama (which wants GGUF) is not the documented serving path. LM Studio and "Atomic Chat" are mentioned as alternative local apps; the primary documented path is Python `mlx-lm` (`from mlx_lm import load, generate`).

## Serving path used by `adapter-local`

`mlx-lm` ships `mlx_lm.server`, which exposes a local OpenAI-compatible HTTP endpoint (chat completions) over an MLX-loaded model — this is the integration point, not a raw Python subprocess bridge (keeps jevcal a pure-TS SDK with zero Python dependency of its own; the user runs `mlx_lm.server` themselves as a prerequisite, same shape as "install Ollama and run it" would have been).

Because the model's fine-tuning already guarantees per-field `value`/`prob`/`confidence`, `adapter-local` parses that nested shape directly rather than reusing `@jevcal/core`'s generic self-reported `${field}_confidence` convention (companion top-level keys) that `adapter-gateway` expects. Confidence is recorded as `{ kind: "native" }` since it's the model's own computed value, same category as Jev's confidence — both are first-class backend-computed probabilities, not jevcal-elicited ones.

## Not yet verified (flag for whoever runs this locally first)

- Exact default host/port `mlx_lm.server` binds to and whether `response_format`/JSON-schema constraints need to be passed explicitly or whether the fine-tuning alone is sufficient — the adapter passes a `response_format` hint defensively but doesn't depend on the server honoring it.
- Whether `top_choices` is always present (treated as optional).
