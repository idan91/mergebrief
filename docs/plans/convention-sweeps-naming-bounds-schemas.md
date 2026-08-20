# Convention sweeps: xOf naming, shared wire bounds, schema location

## Context

BRIEF-197's review rounds settled three conventions that only its own ~10k lines
obey. This ticket sweeps the rest of the repo to match, so the rule holds
everywhere instead of only on the newest code.

## Decisions

| # | Decision |
|---|----------|
| PR shape | 3 stacked PRs off main, one per sweep, chunked commits |
| Reviewer gate | `fable-reviewer` on each PR branch before it goes up; no security/perf agents (mechanical) |
| Schema convention | **Owner-co-located**: a Zod schema lives beside the module that owns the shape (route file, operation, store). A package whose central contract IS the schema keeps it in its established file (`packages/brief-core/src/types.ts` — the domain schema, referenced by other packages' docs). `packages/types` stays types-only, zero runtime. |
| Mandatory skills | `git-eng` for all git operations; `typescript-eng` standards apply |
| Eval harness | Not touched — renames/moves only; no generation-surface change. If any sweep touches `prompt.ts`/output schema semantics, stop and flag. |

## PR 1 — rename `xOf` helpers (branch `chore/brief-215-xof-naming`)

Rule (root `AGENTS.md`): function names start with a verb and name what comes
back. Non-test definitions found on main:

| Current | File | New name |
|---|---|---|
| `commandPathsOf` | `packages/cli/scripts/command-paths.ts` | `getCommandPaths` |
| `commandPathOf` | `packages/cli/scripts/operations-map-lib.ts` | `findCommandPath` (may return undefined) |
| `flagsOf` | `packages/api/.../session/write-input.ts` | `buildFlagSchema` |
| `filesOf` | `packages/worker/src/task/anchoring.ts` | `getGroupFiles` |
| `detailOf` | `packages/worker/src/task/failure.ts` | `getErrorDetail` |
| `originOf` | `packages/worker/src/task/generate.ts` | `getGenerationOrigin` |
| `anchorColumnsOf` | `packages/worker/src/task/generate.ts` | `getAnchorColumns` |
| `firstChunkOf` | `apps/web/e2e/perf/jumpScroll.perf.ts` | `getFirstChunk` |
| `anchorsOf` | `apps/web/.../session/writeGateway.ts` | `buildFlagAnchors` |
| `oneOf` | `apps/web/src/features/brief/utils/validation.ts` | inspect first — if a guard-combinator, `isOneOf`-style verb name |
| `spanKeyOf` | `apps/web/src/routes/repos.$repoId.pulls.$prNumber.tsx` | `buildSpanKey` |

Plus every test-file helper matching `[a-z]+Of` (fixtures in
`packages/api/test`, `brief-core/test`, `cli/test`, `generators/test`,
`worker/test`, `tools/categorizer/test`, web component tests). JSON-schema
field names `anyOf`/`oneOf`/`allOf` in `packages/generators/src/validation`
are wire keys, not helpers — untouched.

Est. ~350–500 LOC (rename lines only). Model: mechanical — run in main thread.

## PR 2 — shared wire bounds (branch `chore/brief-215-wire-bounds`, stacked on PR 1)

Duplicates on main:

- `MAX_PATH_LENGTH = 1_024`: `api/.../session/write-input.ts`, `apps/web/src/features/review/utils/submit.ts`
- `MAX_ID_LENGTH = 256`: `write-input.ts`
- `MAX_INT4 = 2_147_483_647`: `write-input.ts` (int4 column bound — NOT `MAX_SAFE_INTEGER`; values between 2^31−1 and 2^53−1 pass Zod then abort the Postgres write mid-transaction)
- `MAX_BODY_LENGTH = 65_536` / `MAX_REPLY_BODY_LENGTH = 65_536`: `review.ts`, `comments.ts`

One shared module in `packages/api` (e.g. `src/routes/wire-bounds.ts`), one
definition each; route files import. `apps/web` mirrors the api contract
without a package edge (known CI hole) — its copy imports can't cross the
boundary, so web keeps its own constant but the PR notes the mirror site, or
the constant moves to a package web already depends on if one fits without a
new edge. Decide in-flight; do not add a new dependency edge for one number.

Est. ~80–150 LOC. Main thread.

## PR 3 — schema location convention (branch `chore/brief-215-schema-location`, stacked on PR 2)

Survey says the repo is already mostly owner-co-located (route files,
operation files, store files). Work:

1. Write the convention into root `AGENTS.md` (one bullet, lean).
2. Sweep strays: any schema living away from its owner moves beside it.
   `brief-core/src/types.ts` stays (named exception, it IS the domain
   contract). `packages/types` verified runtime-free.
3. No re-exports left behind — callers import from the new location.

Est. ~100–300 LOC depending on strays found. Main thread.

## Gates (every PR)

- `pnpm lint`, `pnpm typecheck` (or per-package equivalents), `pnpm test` for
  changed packages + dependents.
- `fable-reviewer` on the branch diff; medium+ findings iterate (max 2 rounds).
- PR body: overview + changelog; no AI attribution.

## Git requirements (git-eng)

- Stacked branches: PR 1 off `main`, PR 2 off PR 1, PR 3 off PR 2; PRs
  retargeted as the stack merges (squash-merge realign with `rebase --onto`).
- Chunked commits per logical unit; no `Co-Authored-By`; push via `gh`.
