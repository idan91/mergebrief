# packages/brief-core — agent notes

The Brief domain core, extracted byte-identical from `tools/categorizer/src`
(BRIEF-68). Everything production consumes to generate a Brief: the output
schema + closed label vocabulary, the taxonomy prompt, the categorize
engine (behind the `generators` port), repo-context (`.mergebrief/`
semantics), delta/revision/comparison logic, and the huge-span guard.

## Map

**Entry point: `src/lib.ts`** — `exports["."]`; every production symbol is
re-exported there. Two curated subpaths exist for the eval harness only
(precedent: `persistence/testing`): `brief-core/types` (`src/types.ts` —
`Category` and friends) and `brief-core/cli-config` (`extractConfigFlag`).

```
src/
  lib.ts          ENTRY — the public surface
  types.ts        Brief schema + closed vocabulary (docs/mvp/labeling-schema.md,
                  risk-surface.md) — GENERATION SURFACE
  prompt.ts       taxonomy system prompt + REPO_INSTRUCTION_CLASSES
                  (ADR 0032) — GENERATION SURFACE
  categorize.ts   the engine: (pr, context, generator) → Brief / delta /
                  revision narrative
  validate.ts     post-generation validation + salvage integration
  repo-context.ts .mergebrief/ config semantics (globs, budgets, classes)
  diff.ts revchanges.ts comparison.ts manifest.ts huge-span.ts config.ts
  output.ts       brief file writing (CLI output path)
  github.ts       gh-CLI PR fetch + linked-context (CLI/dev + web
                  generate-from-URL; the worker uses its own github-port)
  index.ts        generateAndWrite + the `pnpm categorize` CLI entry
  delta-cli.ts cliConfig.ts   dev CLI entries (invoked from tools/categorizer)
test/             unit suites for all of the above
```

Consumers: `packages/worker`, `packages/repo-config`, `apps/web`,
`tools/categorizer` (CLIs + eval).

## Invariants

- **Generation surface is eval-gated** (root `CLAUDE.md`, BRIEF-59):
  changing `prompt.ts`, the output schema, or validators/salvage ⇒ run
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
