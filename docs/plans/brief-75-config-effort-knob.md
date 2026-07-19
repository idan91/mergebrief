# BRIEF-75 — Config-file effort knob (`effort:` on the generator block)

Plan initialized 2026-07-19 via init-plan. Ticket: BRIEF-75 (board, In progress).
Grill verdict: **not needed** — S-sized on locked BRIEF-11 patterns; per-provider
validity verified 2026-07-19 (validation table on the ticket).

## Goal

Reasoning effort is a hardcoded constant (`EFFORT = "medium"`,
`packages/brief-core/src/categorize.ts:49`) requested per-call for all three
artifact kinds (brief, delta, revision narrative). Make it configurable via an
optional `effort:` field on the `generator:` block of `mergebrief.config.yaml`,
validated against the existing closed `Efforts` vocab (`low | medium | high`).
Zero-config behavior stays **byte-identical** (default `medium`, pinned by test).

**Adapters are frozen.** `effort` already travels on every `GenerateRequest`
and each adapter maps or honestly declines it (per-provider validation on the
ticket: anthropic `output_config.effort`, openai/openrouter runtime-discovered
`reasoning_effort` / `reasoning.effort`, codex `model_reasoning_effort` flag,
claude-code honest `effort: null`). Any design that touches adapter code —
e.g. baking effort into the generator instance at construction — is wrong: the
contract is per-request effort with per-request provenance.

**Out of scope** (recorded on the ticket): extending the vocab with
`xhigh`/`max` (cross-provider + output-affecting on the reference model —
separate eval-gated decision); per-artifact-kind effort (single global knob
now; extend later without breaking).

## Mandates

- **git-eng** for ALL git operations. Requirements: branch
  `feature/BRIEF-75/config-effort-knob` from main; chunked commits (one per
  part below); NO `Co-Authored-By` trailers; NO AI-attribution in the PR body;
  PR title `[BRIEF-75] feat: Config-File Effort Knob For The Generator Block`;
  single PR to main, ready-for-review; **Idan merges**.
- **typescript-eng** (confirmed): strict TS, no `enum` (reuse the existing
  `Efforts` as-const vocab — do not mint a new one), no bare `as`, Result at
  boundaries, exactOptionalPropertyTypes (conditional spreads, not
  `effort: undefined`).
- **test-driven-development** (confirmed): red-first for the schema-validation
  part and the default-pinning test; the threading edits may follow
  test-with-code where a failing test first is impractical (signature changes).
- **fable-reviewer** subagent on the branch diff BEFORE opening the PR;
  findings fixed in-branch (repo pattern: review rounds happen pre-PR, not in
  PR comments).
- Repo conventions: root `CLAUDE.md` + per-package `AGENTS.md`
  (generators, brief-core, worker). Lint/tests judged by EXIT CODE only.

## Convention-gate reasoning (no eval spend)

`prompt.ts` is untouched and the default request is unchanged — pin with a
test that a zero-config load yields effort `medium` and that `categorize`
without an explicit effort requests `medium`. Per root `CLAUDE.md`, the eval
gate covers output-affecting changes; a byte-identical default with a tested
pin does not trigger it. Running an instance at non-default effort is the
operator's deliberate divergence from the committed baselines — that's a docs
statement, not a gate run.

## Shape: ONE PR, three commit-sized parts (~250–350 LOC total, well under the 500 ideal)

Recommended execution: **main thread, Sonnet 5 at high effort** (mechanical
S-ticket on locked patterns — Fable capability is not needed for
implementation; Fable IS the reviewer via the fable-reviewer agent). Parts are
sequential (each builds on the previous) — no subagent fan-out.

### Part 1 — generators: config schema + surface (~100 LOC w/ tests)

TDD: write the failing loader tests first.

1. `packages/generators/src/config/registry.ts`: add optional
   `effort: z.enum(Efforts)` to each adapter's options schema (5 members — or
   a shared base schema merged into each, implementer's choice; keep the
   strict-union pattern). Import `Efforts` from the contract — single source
   of truth.
2. Surface the loaded value: consumers read it off the loaded generator config
   (e.g. `loaded.generator.effort`), defaulting to `"medium"` at the
   consumption site — the schema stays optional, the DEFAULT lives in
   brief-core (one place, next to the old constant's home).
3. Tests (generators): valid values parse per adapter; invalid value rejected
   with a per-field issue naming `effort`; omitted field → undefined; unknown
   sibling keys still rejected (strictness preserved).

### Part 2 — brief-core: thread effort, kill the constant (~100 LOC w/ tests)

1. `packages/brief-core/src/categorize.ts`: the three generation entry points
   (brief ~L202, delta ~L352, narrative ~L457 + their `provenance(EFFORT)`
   twins) take an optional `effort: Effort = "medium"` parameter; delete the
   module constant. Keep parameter position consistent with the existing
   optional-args tail (repoContext precedent).
2. Pin test: calling without effort produces requests + provenance at
   `medium` (the byte-identical guarantee).
3. Threading test: an explicit `low`/`high` reaches `GenerateRequest.effort`
   AND `generation.effort` provenance for all three artifact kinds.

### Part 3 — callers + docs (~80 LOC)

1. `packages/worker`: boot already calls `loadGeneratorConfig(env)`
   (`main.ts`) — pass the loaded effort through the task deps into the
   `categorize` calls in `task/generate.ts` (brief + delta + narrative sites).
2. `packages/brief-core/src/index.ts` (`generateAndWrite`, CLI path) and
   `packages/brief-core/src/delta-cli.ts`: thread from their `--config` load.
3. `tools/categorizer/eval/cli.ts`: replace its own `EFFORT = "medium"`
   mirror with the loaded config's effort — **load-bearing**: the eval's
   `provider:model` baseline key derives from `provenance(EFFORT)`; the eval
   must request and record the same effort the config names, or reports lie.
   (Baselines stay keyed `provider:model`; a non-default-effort eval run is
   the operator's divergence, same as the docs note.)
4. Docs: the self-host generator-config reference (locate under
   `docs/self-host/` at implementation time) gains the `effort:` row + one
   sentence: committed eval baselines assume the default
   (anthropic @ medium); a non-default effort intentionally diverges.
5. Full verification sweep (below), fable-reviewer round, fix findings,
   push, PR.

## Verification (all judged by exit code)

```sh
pnpm -C packages/generators test && pnpm -C packages/generators typecheck
pnpm -C packages/brief-core test && pnpm -C packages/brief-core typecheck
pnpm -C packages/worker test    && pnpm -C packages/worker typecheck
pnpm -C tools/categorizer test  # eval-harness unit suite (no API spend)
pnpm lint                        # root oxlint --type-aware + web lint
```

CI is path-filtered per package (root CLAUDE.md): this PR touches generators,
brief-core, worker, and tools/categorizer — run ALL four suites locally
regardless of what CI picks up. No live eval run (see convention-gate
reasoning); NO baseline or prompt files may change in this PR.

## Deliverables after the PR is up (Idan-facing, required)

1. **Merge guide** — single PR so no stack mechanics: confirm branch is
   green, squash-merge, delete branch; note that no rebaseline and no eval
   run accompany this merge.
2. **Testing guide** — manual verification recipe:
   - zero-config boot (env var unset) → generate on the dev instance →
     brief provenance shows `effort: "medium"` (unchanged behavior);
   - `mergebrief.config.yaml` with `effort: low` → regenerate → provenance
     shows `low` (UI provenance chip / brief JSON `generation.effort`);
   - invalid value (`effort: max`) → boot fails with a per-field ConfigError
     naming `effort` (fail-loud, values omitted);
   - claude-code adapter configured with any effort → warning-free boot,
     provenance `effort: null` (honest gap).
   Cost note: each manual generation is live API spend on the configured
   provider — two generations suffice.

## Ticket flow

BRIEF-75 is already In progress. On PR up: → In review + PR link on the
ticket. On merge (Idan): → Done.
