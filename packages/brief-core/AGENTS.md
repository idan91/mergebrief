# packages/brief-core — agent notes

The Brief domain core, extracted byte-identical from `tools/categorizer/src`
(BRIEF-68). Everything production consumes to generate a Brief: the output
schema + closed label vocabulary, the taxonomy prompt, the categorize
engine (behind the `generators` port), repo-context (`.mergebrief/`
semantics), delta/revision/comparison logic, and the huge-span guard.

## Map

**Entry point: `src/index.ts`** — `exports["."]`; every production symbol is
re-exported there. Two curated subpaths exist for the eval harness only
(precedent: `persistence/testing`): `brief-core/types` (`src/types.ts` —
`Category` and friends) and `brief-core/cli-config` (`src/cli/config.ts` —
`extractConfigFlag`).

```
src/
  index.ts        ENTRY — the public surface
  types.ts        Brief schema + closed vocabulary (docs/mvp/labeling-schema.md,
                  risk-surface.md) — GENERATION SURFACE
  generation/     the eval-gated model surface (root AGENTS.md, BRIEF-59)
    prompt.ts     taxonomy system prompt + REPO_INSTRUCTION_CLASSES
                  (ADR 0032) — GENERATION SURFACE
    categorize.ts the engine: (pr, context, generator) → Brief / delta /
                  revision narrative
    validate.ts   post-generation validation + salvage integration
    repo-context.ts  .mergebrief/ config semantics (globs, budgets, classes)
    huge-span.ts  incremental-vs-full fallback threshold (ADR 0006 #7)
    config.ts     revision-narrative config gate (ADR 0024)
  diff/           mechanical diff parsing — no model calls
    diff.ts       unified diff → per-file patches
    revchanges.ts brief-to-brief changed-line ranges
    comparison.ts comparison marks (ADR 0021/0024)
  artifacts/      written outputs
    output.ts     brief file writing (CLI output path)
    manifest.ts   per-PR brief manifest (head SHA → ordinal)
  cli/            dev CLI entries (invoked from tools/categorizer)
    categorize.ts generateAndWrite + the `pnpm categorize` CLI entry
    delta.ts      the `pnpm delta` CLI entry
    config.ts     `--config` flag extraction (`brief-core/cli-config`)
  github/         PR fetch surface (CLI/dev + web generate-from-URL; the
                  worker uses its own github-port); folder barrel re-exports
    source.ts     PrSource port (BRIEF-97) — the transport seam buildInputs
                  reads through; ghPrSource (gh CLI) is the default impl
    fetch.ts      gh exec + PR/compare fetching
    linked-context.ts  PR-description link chasing + SSRF guard (HTTP, not
                  part of the PrSource port)
    comments.ts   review-comment fetch + normalization
    types.ts      wire shapes (PrLocator, PrMetadata, FetchedPr, …)
test/             unit suites, mirroring the src/ folders
```

Consumers: `packages/worker`, `packages/repo-config`, `apps/web`,
`tools/categorizer` (CLIs + eval).

## Invariants

- **Generation surface is eval-gated** (root `CLAUDE.md`, BRIEF-59):
  changing `generation/prompt.ts`, the output schema, or validators/salvage ⇒ run
  `pnpm -C tools/categorizer eval` and include the report in the PR.
- The Brief never approves, rejects, or scores; enums mirror the closed
  vocabulary docs and change only with them (lockstep tests).
- `REPO_INSTRUCTION_CLASSES` is the operative source of truth for what
  repo instructions may influence (ADR 0032); class changes gate on an ADR
  amendment + eval run.

## Conventions

Repo-wide rules apply (root `CLAUDE.md`): no `enum`, strict TS, no bare
`as`, Zod at boundaries (`zod/v4`), named exports, extensionless relative
imports.

## Verification

```sh
pnpm -C packages/brief-core typecheck
pnpm -C packages/brief-core test
pnpm lint                        # repo-root oxlint --type-aware
```
