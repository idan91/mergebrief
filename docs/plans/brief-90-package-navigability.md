# BRIEF-90 — Entry-point navigability for package trees

> Implementation plan. Grill locked 2026-07-30 (no wayfinder map — the
> [board ticket](https://app.notion.com/p/3a95e9400eeb8179884ac90771ad6fa2)
> holds the locked decisions; this doc adds execution detail). Timing note:
> merge queue was empty and main synced at planning time — land this before
> new feature stacks open, a repo-wide rename conflicts with everything.

## Locked decisions (gist — ticket is canonical)

1. Package entry = `src/index.ts` repo-wide, replacing `lib.ts` (OSS survey 9/10;
   zero internal `./lib` imports, so cost is package.json targets + docs).
2. Conformance bar: entry + `types.ts` + ≤~5 domain-cued loose files; a category
   earns a folder only when it clarifies; generic names are defects.
3. brief-core is the only violator. No ceremony folders elsewhere; small tidies
   at implementer judgment only where they genuinely clarify.
4. brief-core target tree: `generation/` (prompt, categorize, validate,
   repo-context, huge-span, config — mirrors the eval-gate surface), `diff/`
   (diff, comparison, revchanges), `artifacts/` (output, manifest), `cli/`
   (categorize ← src/index.ts, delta ← delta-cli.ts, config ← cliConfig.ts),
   `github/` (verbatim 4-file split of github.ts: fetch, linked-context,
   comments, types). `index.ts` (entry, ← lib.ts) + `types.ts` stay at root.

## Git requirements (git-eng — mandatory for ALL git operations)

- Branches off main, stacked: `chore/BRIEF-90/entry-rename` → PR 1 (base main);
  `chore/BRIEF-90/brief-core-restructure` → PR 2 (base = PR 1 branch).
- **Chunked commits** per logical unit (confirmed 2026-07-30). No Co-Authored-By
  trailers; no AI-attribution in PR bodies.
- **Pre-commit review agents: none** (confirmed — pure motion; the fable loop
  below is the gate).
- Push + open PRs **ready for review**, stacked; Idan merges (squash). After PR 1
  squash-merges, rebase PR 2 `--onto` main per the squash-stack recipe
  (memory: git-push-workflow).
- Titles: `[BRIEF-90] chore: …` per branch-name convention.

## Mandatory skills

- `typescript-eng` (confirmed) — import rewrites, export maps, tsconfig
  interactions. Extensionless imports per repo CLAUDE.md throughout.

## PR 1 — repo-wide `lib.ts` → `index.ts` rename

**Model/effort/invocation:** Opus 5, medium effort, main thread (sequential —
PR 2 depends on it). Est. ~9 renames + ~30 edited lines. Chunks: (1) renames +
export targets, (2) docs.

1. `git mv src/lib.ts src/index.ts` in 8 packages (api, generators, github,
   logging, persistence, repo-config, types, worker; cli has no lib.ts — its
   entry is `bin.ts`, unchanged). brief-core's entry rename rides PR 2: its
   `src/index.ts` is occupied by the CLI pipeline until that PR moves it to
   `cli/categorize.ts`.
2. Update `"."` export target in each package.json (`./src/lib.ts` →
   `./src/index.ts`).
3. Update the 8 AGENTS.md `lib.ts` mentions + add the repo CLAUDE.md rule line
   (entry = `src/index.ts` curated barrel + conformance bar). Historical
   `docs/plans/*` / `docs/dev/*` mentions stay stale, deliberately.
4. Note on ADR 0037: rule extended to package trees (one paragraph, no new ADR).
5. Verify: full `pnpm -r typecheck && pnpm -r test` (rename touches every
   package — path-filtered CI won't cover this; run locally, lint too,
   judge by exit codes).

## PR 2 — brief-core restructure

**Model/effort/invocation:** Opus 5, medium effort, main thread, after PR 1.
Real reviewable diff ≈ github split (~550) + import-line rewrites + docs —
nominal LOC larger but mostly renames; single PR per locked decision. Chunks:
(1) folder moves + import rewrites, (2) github/ split, (3) tests mirror,
(4) config/docs.

1. Folder moves per target tree (`git mv`, content verbatim). Rewrite relative
   imports inside brief-core (`./types` → `../types` etc.).
2. `github.ts` → `github/{fetch,linked-context,comments,types}.ts`, functions
   verbatim; internal imports between the four files; delete original.
3. `test/` mirrors src folders; `__snapshots__` rides with its tests
   (`prompt-snapshots.test.ts` — verify snapshot path resolution after move).
4. Update export targets for `/types` + `/cli-config` in brief-core
   package.json (specifiers unchanged); update
   `tools/categorizer/package.json` scripts (`tsx ../../packages/brief-core/
   src/index.ts` → `src/cli/categorize.ts`, `delta-cli.ts` → `cli/delta.ts`)
   + README table row.
5. Update CLAUDE.md eval-gate path (`prompt.ts` → `generation/prompt.ts`) +
   brief-core AGENTS.md tree.
6. Verify: brief-core + categorizer suites, `pnpm -r typecheck`, plus a smoke
   of both categorizer scripts resolving (`pnpm -C tools/categorizer
   categorize --help`-shape or dry parse). **No eval run — $0** (verbatim
   moves; if any file CONTENT changes beyond imports, that's a plan deviation
   to flag).

## Review loop (both PRs)

After each branch is complete (pre-push): dispatch **fable-reviewer** on the
branch diff. Iterate medium+ findings until clean; low/nitpick-only pass =
clean, note it in the PR body (feedback-review-loop-severity). Then push +
open the PR per git-eng.

## Out of scope

- api/cli/github-package tidies beyond judgment-level (bar says they conform).
- Any brief-core content refactors (splitting validate.ts, etc.).
- Eval-harness runs.
