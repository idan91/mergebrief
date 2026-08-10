# BRIEF-174 — carrier → core rename (schema, prompt, internals, docs)

Decisions locked on the ticket (grilled 2026-08-10); this plan executes them.
One atomic code PR + a docs-only sweep straight to main.

## Locked decisions (gist — detail on ticket)

- Hard break on stored data; no permanent read-path alias. One-off idempotent
  migration script (committed, `toDelete` filename prefix) rewrites kept test
  generations: `"carrier"` → `"core"`, `carrierChunkIds` → `coreChunkIds`.
  Deletion of `toDelete*` files is owed to the OSS launch cutover ticket.
- Full sweep: role value, `carrierChunkIds` persisted field, consts
  (`STYLE_FILES_CARRIER_RULE`), fixtures, comments, tests, README.
- Prompt: meaning-first rewrite of the role teaching blocks (initial +
  revision) — `core` = holds the group's intent, with a defensive clause
  against the "core = most important / largest" misread. Rest = word swap.
- Eval: NO automatic spend. Optional full or scoped run decided at a
  post-merge checkpoint; `--rebaseline` only if a run happens.
- One atomic PR: web keeps its own `Roles` copy, so a split rename leaves a
  window where worker output is rejected by web — invisible to path-filtered
  CI. All packages flip in one merge.

## Git workflow (git-eng — mandatory for ALL git operations)

- Branch off main: `feature/BRIEF-174/carrier-core-rename`.
- Chunked commits, one per part below. Before every commit:
  `performance-reviewer` on staged diff; findings ≥80 confidence fixed before
  committing. No Co-Authored-By / AI-attribution anywhere.
- PR: `[BRIEF-174] chore: Rename Carrier To Core Across Schema Prompt And Internals`,
  base main, ready (not draft). Body: overview + changelog + eval-checkpoint
  note (why no eval report rides along — locked decision).
- Docs sweep is a separate docs-only commit straight to main (standing
  authorization), after the PR merges.

## Mandatory skills

- `typescript-eng` — all code edits.
- `verify` — runtime end-to-end pass before PR: generate a brief, load it in
  web, run the migration script against the real store.

TDD not adopted: tests move in lockstep with the rename; no new behavior.

## Parts (= commits) — one PR, est. ~550–700 LOC total

Sequential in the main thread, single session (shared context, one branch).
Fable 5; effort high for Part 1 (prompt semantics), medium for the rest
(mechanical).

1. **brief-core** (~200 LOC): `types.ts` Roles map; prompt.ts teaching-block
   rewrite (both prompts) + `STYLE_FILES_CARRIER_RULE` → `STYLE_FILES_CORE_RULE`
   + standalone-group rule; validate/salvage/output; tests; **prompt snapshot
   regenerated in this same commit** (BRIEF-154 lockstep trap).
2. **worker + generators + cli** (~15 LOC): 4 files, mechanical.
3. **apps/web** (~250 LOC): `types.ts` Roles copy, `validation.ts` (role value
   + `carrierChunkIds` → `coreChunkIds`), viewModel/state/components, tests,
   e2e brief fixtures (2 JSON files, hand-edit).
4. **tools/categorizer** (~15 LOC): eval-pairs test fixtures + README.
5. **migration script** (~130 LOC): `toDelete-` prefixed, idempotent, covers
   DB brief rows and local `.brief.json` files; rewrites role values and the
   `carrierChunkIds` key.

## Verification gates (all pre-push)

- Grep gate: `grep -rn "carrier" .` (all file types) → zero hits outside
  `docs/plans/**`, `docs/adr/**`, `.git`. Case-insensitive pass too.
- ALL package suites locally (`pnpm test` per package) — path-filtered CI
  will not cross-check the vocab handshake.
- `verify` skill runtime pass (generation → web render → migration script run
  twice to prove idempotence).

## Post-merge checkpoint (owed)

Ask Idan: run full eval suite ($9.70), a scoped role-property run, or skip.
Rebaseline on main only if a run happens and the surface legitimately moved.

## Docs sweep (separate, straight to main)

`docs/mvp/**`, `docs/impl/**`, `docs/next-steps.md`,
`docs/competitive-analysis.md`, package `AGENTS.md` files, categorizer README
leftovers. Exempt: `docs/plans/**`, `docs/adr/**`. Also amend the BRIEF-154
keep-list (ticket-side): `carrier/supporting` moves keep → renamed.
