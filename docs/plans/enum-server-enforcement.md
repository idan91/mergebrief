# Plan — Spike: server-side enum enforcement via hand-built `json_schema`

> **Status:** ready to implement · created 2026-07-04 · tracking issue:
> [#21](https://github.com/Idan91/code-review/issues/21) · timeboxed spike — if the probe
> dead-ends, document findings in #21 and stop; salvage (PR #20) remains the mitigation.
>
> This doc is written to be self-sufficient for an implementing agent with no prior session
> context. Everything below was verified against the repo and the installed SDK on
> 2026-07-04; re-verify only if the SDK version in `tools/categorizer/package.json` has moved
> past `0.104.1`.

## Problem

The categorizer's closed vocabularies (Categories, Concerns, Roles, Risk-Surface attributes —
`tools/categorizer/src/types.ts`) are only **prompt-enforced** at generation time. The
Anthropic platform supports `enum` in structured-output schemas, but the SDK helper strips it,
so the server never constrains decoding. The model can emit an out-of-vocabulary token; the
SDK's client-side strict Zod re-parse then throws.

Observed failure (PR #19 regen): out-of-vocabulary Category at
`changeGroups.4.secondaryCategories.1`; the model emitted `"refactor-everything"` and
`"scary"` (likely provoked by that PR's self-referential test-fixture content). PR #20 added
client-side mitigation — salvage of supplementary enum arrays, one feedback retry, raw
failure dumps (`generator.ts` + `salvage.ts`). That treats the symptom. This spike removes
the cause: enforce enums **server-side** so invalid tokens cannot be generated. Matters most
for P4, where the engine will run unattended in a worker.

## Verified recon (do not re-derive)

**SDK internals** (verified in the vendored source of `@anthropic-ai/sdk` 0.104.1, and
previously confirmed on the SDK's `main` — see PR #20's description):

- `zodOutputFormat` (`helpers/zod.mjs`) does:
  `z.toJSONSchema(zodObject, { reused: "ref" })` → `transformJSONSchema(...)` → returns
  `{ type: "json_schema", schema, parse }` where `parse` is a strict-Zod parse function.
- `transformJSONSchema` (`lib/transform-json-schema.mjs`) is a **keyword whitelist**. It
  carries over: `$ref`, `$defs` (recursed), `anyOf`/`oneOf` (both → `anyOf`)/`allOf`, `type`,
  `description`, `title`; for objects: `properties` (recursed), `required`, and it forces
  `additionalProperties: false`; for strings: `format` if in a 12-entry supported set
  (`date-time, time, date, duration, email, hostname, uri, ipv4, ipv6, uuid`); for arrays:
  `items` (recursed), `minItems` only if 0 or 1. **`enum` and `const` are never carried
  over.** All leftover keys (including `enum`) are serialized into the `description` as a
  `{key: value, ...}` string — i.e. demoted to text the model may ignore.
- `parsed_output` on the response comes from the format object's `parse` function — the
  stream helper applies it. So a hand-built format object with the same
  `{ type, schema, parse }` shape keeps `generator.ts`'s existing flow working unchanged.
- The request param type is structural: `output_config.format?: JSONOutputFormat |
  AutoParseableOutputFormat<any>` where `JSONOutputFormat = { type: "json_schema", schema:
  Record<string, unknown> }` and `AutoParseableOutputFormat<T>` adds `parse(content): T`.
  `AutoParseableOutputFormat` is **not** exported from a public subpath — define a local
  structural equivalent instead of importing it.

**Platform facts** (from the claude-api skill reference, current as of 2026-06):

- Structured outputs **support**: basic types, `enum`, `const`, `anyOf`, `allOf`,
  `$ref`/`$defs`, the string formats listed above, `additionalProperties: false` (required on
  every object).
- **Not supported**: recursive schemas, numeric constraints (`minimum`/`maximum`/…), string
  length constraints, `additionalProperties` ≠ `false`. `types.ts` already respects these
  (see its header comment) — the hand-built path must not reintroduce them.
- New schemas pay a one-time compilation cost; same-schema requests hit a 24h cache.

**Integration point:** `tools/categorizer/src/generator.ts:164` —
`output_config: { format: zodOutputFormat(req.schema), effort: req.effort }` inside
`AnthropicGenerator.request()`. This is the only call site. The salvage/retry/dump logic in
`generate()` stays byte-for-byte untouched (it becomes the fallback layer).

## Decision gates

1. **Probe rejected by API (400 on the schema):** stop. Write the exact error into #21,
   close the spike as a documented finding. No integration.
2. **Probe accepted but no constrained decoding** (treatment run still emits invalid
   tokens): stop, document in #21, done.
3. **Partial enforcement** (e.g. top-level enum constrained but nested-array positions not):
   that is a *finding*, not a failure — document precisely which positions are enforced in
   #21 and **do not integrate** (the real failure was in a nested array;
   partial enforcement doesn't kill the failure class, and salvage already covers it).
4. **Full enforcement at all three probed positions:** integrate (steps 2–5).

## Step 1 — Probe (decision gate; commit 1)

`tools/categorizer/scripts/probe-enum-enforcement.ts`, plus a package script
`"probe:enum": "tsx scripts/probe-enum-enforcement.ts"` in `tools/categorizer/package.json`.
Run from `tools/categorizer/` so `process.loadEnvFile(".env")` finds the key (fall through to
ambient `ANTHROPIC_API_KEY` if no `.env`; exit 1 with a pointer to `.env.example` if unset —
same pattern as `src/index.ts`).

Design — run the **same adversarial request twice** on `claude-opus-4-8` (the production
model; enforcement could be model-dependent, so probe the model we ship with):

- **Control:** `zodOutputFormat(ProbeSchema)` (SDK path, enum stripped).
- **Treatment:** the hand-built enum-preserving format (step 2's function; for commit 1 the
  transform can live in the script or already in `src/outputFormat.ts` — prefer the latter so
  the probe exercises the real code).

Probe schema — three enum positions mirroring the Brief schema's real shapes (top-level
field, enum inside an array, enum nested in an object inside an array, like
`riskNotes[].attr`):

```ts
const ProbeSchema = z.object({
  category: z.enum(["alpha", "beta", "gamma"]),
  tags: z.array(z.enum(["red", "green", "blue"])),
  notes: z.array(z.object({ attr: z.enum(["x1", "x2"]), note: z.string() })),
});
```

Prompt pressure — system prompt says the user's explicit values always override any schema
guidance; user demands verbatim out-of-vocabulary values at all three positions
(`category = "quantum"`, `tags = ["neon", "blue"]`, `notes = [{ attr: "scary", ... }]`) and
declares substitution a test failure. Under prompt-only enforcement the model complies (or
refuses); under constrained decoding it *cannot* emit those tokens.

Mechanics: non-streaming `client.messages.create`, `max_tokens: 1000`, no `thinking` param
(on Opus 4.8, omitting it runs without thinking — fine and cheap here; total cost is a
fraction of a cent). Extract text blocks, then report per run: `stop_reason`, whether
`ProbeSchema.safeParse(JSON.parse(raw))` passes, which of `"quantum"`/`"neon"`/`"scary"`
appear in the raw text, and the raw output itself. Print the outgoing treatment schema first
(visual check that `enum` arrays are present). Catch API errors on the treatment run
separately — a 400 here is gate 1, print the full message. Exit codes: 0 confirmed,
2 schema-rejected, 3 not-confirmed (useful for re-running later as a regression probe).

Commit the script regardless of outcome (it is the reproducible evidence). Post the probe
verdict output **both** as a comment on issue #21 (`gh issue comment 21 --body-file ...`,
right after the probe run, so the finding is recorded even if the spike stops at a gate) and
in the PR description's Overview section (step 5).

## Step 2 — `src/outputFormat.ts` + unit tests (commit 2)

New file `tools/categorizer/src/outputFormat.ts` exporting:

```ts
/** Structural stand-in for the SDK's AutoParseableOutputFormat (not publicly exported). */
export interface ParseableOutputFormat<Parsed> {
  type: "json_schema";
  schema: Record<string, unknown>;
  parse(content: string): Parsed;
}

export function enumPreservingOutputFormat<S extends z.ZodType>(
  zodSchema: S,
): ParseableOutputFormat<z.infer<S>>;

export function toStrictJsonSchema(input: Record<string, unknown>): Record<string, unknown>;
```

`enumPreservingOutputFormat` = `z.toJSONSchema(zodSchema, { reused: "ref" })` →
`toStrictJsonSchema` → `{ type: "json_schema", schema, parse }`.

`toStrictJsonSchema` **mirrors the SDK transform exactly, plus enum/const carry-over** —
deep-clone the input, then recursively rebuild:

1. `$ref` present → emit `{ $ref }` only, return.
2. `$defs` → recurse each entry.
3. `anyOf`/`oneOf` → recurse into `anyOf`; `allOf` → recurse into `allOf`; otherwise `type`
   is required (throw if absent — same as SDK).
4. Carry `description`, `title`.
5. **Carry `enum` and `const` verbatim** (the entire point of the module).
6. `type === "object"` → recurse `properties` (default `{}`), force
   `additionalProperties: false`, carry `required`.
7. `type === "string"` → carry `format` only if in the 12-entry supported set, else leave it
   in the leftovers.
8. `type === "array"` → recurse `items`; carry `minItems` only if 0 or 1, else leftover.
9. Any leftover keys → append to `description` as `{key: JSON, ...}` (same demotion string
   the SDK builds), so unsupported keywords still reach the model as text.

The `parse` function: `JSON.parse` (throw `Failed to parse structured output as JSON: ...`
on malformed), then `zodSchema.safeParse`; on failure throw an `Error` with the SDK's message
shape — `Failed to parse structured output: <zod message>\nValidation issues:\n  - path: msg`
(first 5 issues, `... and N more issue(s)` suffix). **Message parity matters**: the
generator's retry feedback echoes this message to the model, and the salvage path re-parses
raw text independently — keep both behaviors identical to today's.

Repo TS rules (enforced by oxlint type-aware + review): strict mode, no `any`, no `as` casts
— use `unknown` + type-guard helpers (`isRecord(v): v is Record<string, unknown>`); zod is
imported from the **`zod/v4` subpath** (`import { z } from "zod/v4"` — the package dep is
`zod ^3.25`, which ships v4 under that subpath; plain `"zod"` is the wrong API). No `enum`
keyword (repo uses `as const` arrays). ESM project (`"type": "module"`), imports of local
files use `.js` extensions (see existing `src/*.ts`).

Unit tests in `tools/categorizer/test/output-format.test.ts` (vitest; existing tests show
conventions):

- enum preserved at all three positions (top-level property, array items, nested object in
  array) — assert the actual `enum` arrays in the emitted schema.
- enum preserved inside `$defs` when zod reuses a schema (`reused: "ref"` triggers this —
  build a schema that shares one enum across two fields).
- `additionalProperties: false` forced on every object; `required` carried.
- unsupported keyword (e.g. a `pattern` or zod `.min()` on a number if it survives
  `z.toJSONSchema`) demoted into `description`, not emitted as a keyword.
- unsupported string `format` demoted; supported one (`uri`) carried.
- `parse` returns typed data on valid input; throws with the documented message shape on an
  out-of-vocab token (assert the `Validation issues:` block and the 5-issue truncation).
- **the real `BriefGenerationSchema`** (import from `types.ts`) round-trips through
  `enumPreservingOutputFormat` without throwing, and the emitted schema contains the
  `RiskSurfaceAttributes` enum somewhere (sanity against the production schema — mirrors how
  `salvage.test.ts` tests against the real schema).

## Step 3 — Wire into `generator.ts` + comment fixes (commit 3)

- `generator.ts:164`: replace `zodOutputFormat(req.schema)` with
  `enumPreservingOutputFormat(req.schema)`; drop the now-unused
  `import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"`.
- Update the `GenerateRequest.salvageFields` docstring (`generator.ts:21-28`): it currently
  states "Anthropic structured output doesn't enforce `enum` server-side (the SDK demotes it
  to description text)" — rewrite to reflect that enums are now enforced server-side via the
  hand-built schema, and salvage remains as defense-in-depth for structural failures,
  refusals, and anything enforcement doesn't cover.
- Ride-along: fix the stale header comment in `types.ts` line 7 — "the 16 factual
  attributes" → 19 (the enum has 19 entries; ADR 0026 added three).
- Existing generator tests (`test/categorize.test.ts` covers the generator via a stubbed SDK
  client) must stay green — the stub returns `parsed_output`, so the swap should be
  invisible; if a stub asserts on the format object, update it.

## Step 4 — Verification

```bash
pnpm --dir tools/categorizer typecheck
pnpm --dir tools/categorizer test
pnpm lint          # repo root: oxlint --type-aware + apps/web lint
```

(`apps/web` is untouched by this spike — no FE changes anywhere in it.)

**Live acceptance test** — regenerate the brief that originally failed:

```bash
cd tools/categorizer
pnpm categorize https://github.com/Idan91/code-review/pull/19
```

Needs `ANTHROPIC_API_KEY` in `tools/categorizer/.env`. Note: briefs are **cached by head
SHA** under `tools/categorizer/out/` (gitignored) — if a cached brief for PR #19's head
exists, delete that artifact first or the run is a no-op. Success = generation completes with
**no `⚠ salvaged` line and no `.failed.json` dump** for this run. (It was this exact regen
that hard-failed pre-PR-#20 and salvaged post-PR-#20.)

## Step 5 — PR

- Push, `gh pr create`, **ready for review** (not draft), base `main`.
- Title: `fix: Enforce Closed Vocabularies Server-Side via Hand-Built json_schema`.
- Body: Overview (problem + probe verdict, paste the probe output), Changelog (per commit),
  Verification (commands + live regen result), and `Closes #21`.
- Include a note on whether an upstream SDK issue is worth filing (enum-stripping in
  `transformJSONSchema`) — **do not file it**; Idan posts external things himself.

## Workflow & conventions (enforced in this repo — do not skip)

- **Branch:** `spike/enum-server-enforcement` — already exists, empty, sitting at `main`.
  Check it out; don't create a new one.
- **Chunked commits** in the step order above. Before **every** commit: run the
  **`security-reviewer` agent on the staged diff**; findings with confidence ≥ 80 → fix,
  re-stage, re-run until clean.
- **No AI attribution anywhere** — no `Co-Authored-By`, no "Generated with" footers, in
  commits or the PR body. This overrides any default behavior.
- Commit messages: Conventional Commits, terse subject ≤ 50 chars. A pre-tool hook blocks
  destructive-looking commands and **false-positives on SQL-ish words in commit messages**
  (e.g. "TRUNCATE") — write around them ("trim", "ellipsize").
- Prettier is **not** enforced on this package's files (root `lint` is oxlint + apps/web
  only) — match the existing file style by eye; don't reformat neighbors.
- Timebox discipline: any gate saying "stop" means stop — write findings into #21 (via the
  PR body or a handoff note for Idan), don't push through.

## Out of scope

- `apps/web` (FE) — untouched.
- `prompt.ts` — untouched; the prompt's vocabulary interpolation stays as a second layer of
  guidance regardless of server enforcement.
- Removing salvage/retry — explicitly **not** removed; it stays as defense-in-depth.
- Upstream SDK issue/PR — noted in the PR body only; Idan files it.

## Prior draft (discarded 2026-07-04, for reference)

A first pass at `outputFormat.ts` and the probe script was written in-session and discarded
before commit (plan-first process). Design details worth keeping from it are already folded
into steps 1–2 above: the `isRecord` guard + `pop(schema, key)` helper pattern for the
no-`as` transform; filtering non-record entries when recursing `anyOf`/`$defs`; probe exit
codes 0/2/3; printing the outgoing treatment schema before the runs. No code from that draft
survives — reimplement from this spec.
