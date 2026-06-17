# Provider-Agnostic Generation, BYOK, and Generation Provenance

All model generation goes through one internal **`Generator` port** whose base contract is **structured generation** — `(schema, system, user) → object valid against the Zod schema`. The Anthropic path stays on the official `@anthropic-ai/sdk`; other providers (BYOK) are additional adapters behind the same port. Each adapter may expose its provider's extra capabilities (thinking, effort, prompt caching) without those leaking into the base signature, and every brief/delta records its **Generation provenance** (provider, model, effort) so the **Receipt** stays honest about what produced the analysis. Non-secret provider/model selection lives in the per-repo **YAML** config (ADR 0006); API keys resolve from env/secret-store by name and never live in the config file.

## Context

The categorizer hardcodes `claude-opus-4-8` via `new Anthropic()`, and its generation path leans on four Anthropic-specific levers: `output_config.format` + `zodOutputFormat` (structured output), `effort`, adaptive `thinking`, and `cache_control` prompt caching. Two pressures motivate a seam: the documented **Open-Core / BYOK split** (`next-steps.md`, post-Phase-2 — "code/keys never leave the org" kills the enterprise privacy objection), and the **tiered triage** cascade (ADR 0010) which varies model/effort per call. The decision was grilled with the directive "design the seam well now, ship Anthropic-only, make BYOK a clean drop-in."

The only thing portable across providers is "(system, user, schema) → parsed object." Structured output is the **least portable, most load-bearing** piece — every provider does it differently and some models can't do strict schemas at all, yet the entire product rests on schema-valid output.

## Decision

1. **One `Generator` port, structured generation as the base contract.** `generate({ schema, system, user, effort?, model? }) → z.infer<schema>`. The existing single chokepoint (`streamStructured`) becomes the port. Every supported adapter must honor this contract.
2. **Anthropic on the official SDK.** The Anthropic adapter is today's code on `@anthropic-ai/sdk` — keeping native structured output, adaptive thinking, effort, and prompt caching. We do **not** route Claude through a generic shim or the Vercel AI SDK (the claude-api guidance: official SDK is the default for Claude; never an OpenAI-compatible shim). BYOK adapters are added when a real provider is needed.
3. **Structured output is a hard floor, not best-effort.** A provider/model that can't reliably produce schema-valid output is a **fail-fast config error**, never a silent text-mode degrade (a malformed brief is worse than none). Support schema-capable providers first (Anthropic native; schema-capable BYOK models); non-schema providers are an explicit **TODO**, not a fallback.
4. **Adapters expose provider features; the base never strips them ("seamless").** Per-call knobs the core legitimately varies — `effort`, `model` (for triage) — are normalized on the base signature. Static, provider-specific features (thinking mode, cache strategy, endpoint) are **typed, Zod-validated per-adapter options** set at construction from that provider's config block. An opaque `providerOptions` passthrough escape hatch is deferred as a TODO.
5. **Generation provenance.** Every Brief/Delta records `{ provider, model, effort }` (CLI-owned metadata, omitted from the model's generation schema, filled by the runtime — same discipline as `index`/`commitRange` in ADR 0012). It surfaces on the **Receipt** (canonical) and as an understated header label. Capabilities a BYOK provider lacks (no thinking, no caching) are reflected here so the reviewer knows the analysis may be weaker — never mistaking it for a verdict.
6. **Config substrate = per-repo YAML; keys via env.** Provider, model/tier, effort, and per-adapter options live in the per-repo YAML already planned in ADR 0006 (org defaults + per-repo override), Zod-validated at load. **API keys never appear in the file** — they resolve from env/secret-store, referenced by name (`apiKeyEnv: …`). The stateless dogfood CLI keeps env + flags for now; YAML is the product-runtime shape.

## Considered Options

- **Seam shape.** Vercel AI SDK as the universal layer (rejected: routes the Anthropic path off the official SDK, stacks a second heavy abstraction over the SDK we already use) · OpenRouter-only gateway (rejected: structured-output/reasoning support varies by model — the gateway's weakest spot — and makes OpenRouter a hard dependency even for Claude) · **own thin `Generator` port (chosen)** — "an interface that fits all," Anthropic on the official SDK.
- **Capability handling.** Lowest-common-denominator port (rejected: degrades the primary path to the weakest provider, drops the structured-output guarantee) · capability-flags negotiation (rejected: premature/blind with one provider built) · **hard structured-output floor + best-effort levers recorded in provenance (chosen).**
- **Config format.** Env-only (rejected: flat, no per-repo override or tier structure, diverges from ADR 0006) · TS config file (rejected: executable repo-supplied code is an RCE/sandbox risk in a hosted product, pins the config layer to JS/TS, diverges from ADR 0006) · **per-repo YAML + env keys (chosen)** — inert data, stack-agnostic, governance-ready, ADR-0006-consistent.

## Why This Way

The port keeps the Anthropic path full-strength (its strengths are the reason the tool works today) while making BYOK an additive adapter rather than a rewrite — and the single existing chokepoint makes the seam nearly free. Making structured output a hard floor protects the one invariant the whole product rests on; routing capability *differences* into Generation provenance (rather than into branching logic or a dumbed-down interface) keeps the core simple and the Receipt honest. YAML-with-env-keys is the only config choice where the mandated boundary validation is load-bearing rather than redundant, and the keys-never-in-file rule is the concrete form of the BYOK trust promise.

## Consequences

- **New module:** a `Generator` interface + `AnthropicGenerator` (today's `streamStructured`), with per-adapter Zod-validated option types. The categorizer depends on the port, not on `Anthropic` directly.
- **Schema growth:** Brief/Delta gain a `generation` provenance object (CLI-owned, omitted from generation), consistent with ADR 0012's metadata pattern. `CONTEXT.md` already carries the **Generation provenance** term.
- **Config:** the per-repo YAML (ADR 0006) gains a `generator:` block; a Zod loader validates it; secret resolution is by env-var name only.
- **Scope/sequencing:** Anthropic-only ships now; OpenRouter / AI-SDK / other adapters and the `providerOptions` escape hatch are post-Phase-2 (per the BYOK split), as is the YAML loader (CLI stays env+flags).
- **Trust posture:** directly advances the deferred GPT-5.5 review item #6 (secret handling, provider exposure, BYOK/self-host).
- Builds on ADR 0006 (per-repo YAML), 0010 (triage varies model/effort), 0012 (CLI-owned metadata discipline).
