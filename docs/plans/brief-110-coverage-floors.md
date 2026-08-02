# BRIEF-110 — Coverage floors: 75% lines per package baked into `pnpm test`

Status: planned 2026-08-02. Policy source: [ADR 0038 §3](../adr/0038-constraint-mesh-test-quality-gates.md)
(constraint mesh, decided on the BRIEF-82 wayfinder map). Board ticket: BRIEF-110.

## Goal

Every package's `pnpm test` run enforces a committed lines-coverage floor —
identical wall for agents, maintainer, CI (when BRIEF-37 revives it), and
fork PRs. No separate gate to remember; a PR that drops a package below its
floor fails that package's tests.

## Locked decisions (do not relitigate — ADR 0038 §3)

- `@vitest/coverage-v8`; **75% lines** per package; lines only (no
  branch/function thresholds in v1).
- Packages measured under 75% get a **temporary floor at their measured
  level** (rounded DOWN to the nearest whole %) + one catch-up board ticket
  per package.
- Exclusions: generated artifacts (`drizzle/` output, `routeTree.gen.ts`,
  `*.gen.*`), type-only files (`types.ts`, `*.d.ts`), re-export-only entry
  barrels, vitest defaults. Per-file `v8 ignore` comments require a stated
  reason (treated like a lint-disable in review).
- Gate location: each package's `test` script becomes
  `vitest run --coverage`; thresholds live in that package's vitest config.
- Ratchet/autoUpdate deliberately NOT adopted (revisit trigger recorded in
  the ADR).

## Git requirements (git-eng — mandatory for all git operations)

- Branch: `chore/BRIEF-110/coverage-floors` off `main`.
- **Chunked commits** — one per logical unit (see steps); no
  `Co-Authored-By` trailers, no AI attribution anywhere.
- **Pre-commit gate: `performance-reviewer`** on staged changes before
  every commit; fix findings ≥80 confidence, re-run until clean.
- Push + PR via `gh` at the end: title `[BRIEF-110] chore: Coverage Floors
  — 75% Lines Per Package`, base `main`, standard Overview/Changelog body
  (no images — tooling PR). Ask before pushing.

## Specialist skills (mandatory)

- `typescript-eng` — vitest config authoring across packages; repo TS
  standards (extensionless imports, named exports, no `any`).

## Facts to verify at implementation start

- Which workspace packages have vitest suites (2026-08-01 count: web 74+,
  api, persistence, github, brief-core, generators, categorizer, cli,
  repo-config, logging, worker — `packages/types` likely has none; packages
  without suites get NO coverage config until they gain tests; record the
  list in the PR body).
- Existing vitest config situation per package: most have **no**
  `vitest.config.ts` (bare `vitest run` on defaults); `apps/web` configures
  test via its `vite.config.ts`; web e2e serial project config exists.
  Extend what exists; create minimal configs only where absent.

## Work shape — single PR

Config-heavy, ~11 packages × (devDep + small config + script line) plus
measurement notes ≈ well under 500 LOC. One PR; chunked commits inside it.

Run: **main thread, Opus 5** (execution work per the plan-model rule;
design was done on the map). No subagents — steps are sequential and each
depends on the previous one's output.

### Step 1 — Tooling in place (commit 1)

Add `@vitest/coverage-v8` (matching each package's vitest major) as a
devDependency to every package with a vitest suite. Create/extend vitest
configs with the exclusion set only (no thresholds yet). Flip each `test`
script to `vitest run --coverage`. Full `pnpm -r test` must stay green
(coverage reporting on, nothing gated yet).

### Step 2 — Measure and set floors (commit 2)

Run coverage across all packages; record per-package lines %. Set
`coverage.thresholds.lines` per package: `75` where measured ≥75; the
measured value rounded down where <75. Table of measurements goes in the
PR body verbatim.

### Step 3 — Debt + docs (commit 3)

- File one catch-up board ticket per under-floor package (Priority: Later,
  Roadmap: "v1 release gate debt", body links this plan + ADR 0038 §3),
  linked from the PR body.
- Root `CLAUDE.md`: one line under the repo rules stating the coverage
  floor convention and that `v8 ignore` needs a stated reason (keep it to
  ~2 lines — the ADR holds the detail).

### Gates before PR

- `pnpm -r test` green (all floors passing by construction).
- `pnpm lint` exit 0.
- No eval-harness trigger (no generation-surface files touched).

## Out of scope

- CI wiring (BRIEF-112, blocked on BRIEF-37) — the floors bite in CI
  automatically once it revives, via `pnpm test`.
- Writing catch-up tests for under-floor packages (their tickets).
- Ratchet/trend tooling (parked, ADR 0038).
