# BRIEF-68 — split tools/categorizer: domain core → packages/brief-core

Ticket: BRIEF-68 (board). Pure-move refactor: the production-critical
domain core leaves `tools/` (which implies dev-only) for `packages/`
(the production graph); dev CLIs + eval harness + the direct
`@anthropic-ai/sdk` dependency stay in `tools/categorizer`.

## Decisions (user-confirmed at plan time, 2026-07-19)

- **Package name: `brief-core`** (`packages/brief-core`) — consumer imports
  rewritten `"categorizer"` → `"brief-core"` in the same PR.
- **Surface verification: static proof only** — no live eval run. Moved
  modules must be byte-identical (sha256 pre/post recorded in the PR body);
  full unit suites green. Live eval stays reserved for changes that alter
  generation content. (Convention-gate reading: a byte-identical move does
  not move the surface.)
- **Commit strategy: chunked** (move / rewire / docs).
- **Specialist skill: `typescript-eng`** mandatory (package.json, tsconfig,
  exports wiring). `tdd` not adopted — no new behavior; tests move.

## Git (git-eng — mandatory for all git operations)

- Branch `feature/BRIEF-68/brief-core-split` off fresh `main`.
- Chunked commits per part below; no Co-Authored-By trailers; no AI
  attribution in the PR body.
- Pre-PR gate: `reviewer` subagent on the full branch diff; findings
  fixed before PR. PR ready-for-review (not draft), base `main`; Idan merges.

## File partition (FINAL — Part-1 import audit; supersedes the ticket's
## imagined "CLIs stay" split)

The audit found `apps/web`'s generate-from-URL path consumes
`generateAndWrite` (`index.ts`) and the gh-CLI functions (`github.ts`,
`fetchPrMetadata`/`parsePrUrl`), and `index.ts` pulls `cliConfig.ts` — so
the dependency rule (consumed by production ⇒ moves) closes over the
**entire `src/`**:

- **Moves (byte-identical, whole `src/` + unit tests)** to
  `packages/brief-core`. New package exports: `.` (lib, surface unchanged)
  plus two curated subpaths for the eval harness's non-lib symbols —
  `./types` (`Category`) and `./cli-config` (`extractConfigFlag`)
  (precedent: `persistence/testing`).
- **Stays in `tools/categorizer`**: `eval/` + its tests and fixtures,
  `scripts/` (probe — the sole `@anthropic-ai/sdk` user), package.json
  whose `categorize`/`delta` scripts are thin `tsx` entries into
  brief-core's moved CLI files. Eval imports go through the package.

## Parts / PR

**One PR** (~renames + a few hundred changed import/wiring lines; well
under the 1000-LOC ceiling since git tracks the moves as renames).
All parts run **sequentially in the main thread (Fable, current session)**
— mechanical work on hot context; no subagent fan-out. `reviewer`
subagent for the gate only.

1. **Move** — create `packages/brief-core` (package.json `"brief-core"`,
   tsconfig mirroring siblings, `exports["."] = lib`), `git mv` the domain
   core + its tests, keep internal structure identical. Record pre/post
   sha256 of moved files.
2. **Rewire** — consumers (`packages/worker`, `packages/repo-config`,
   `apps/web`) package.json deps + import lines; `tools/categorizer`
   package.json gains `brief-core` workspace dep, CLI/eval relative imports
   → package imports; CI path filter (`.github/workflows/ci.yml`
   categorizer-checks glob) gains `packages/brief-core/`; worker Dockerfile
   comment.
3. **Docs** — new `packages/brief-core/AGENTS.md` + `CLAUDE.md` pointer,
   `tools/categorizer/README.md` reframe (CLIs + eval on top of
   brief-core), worker/repo-config AGENTS.md mentions, root CLAUDE.md
   eval-gate path (`tools/categorizer/src/prompt.ts` →
   `packages/brief-core/src/prompt.ts`).

## Verification (before PR)

- sha256 equality table for every moved file (pure-move proof).
- Suites: brief-core, categorizer (CLI/eval unit tests), worker,
  repo-config, apps/web — all locally (path-filtered CI + CI billing
  blocker; convention BRIEF-23).
- `pnpm lint` exit 0 at root; typecheck per touched package.
- No behavior/prompt/schema change of any kind (ticket's out-of-scope).
