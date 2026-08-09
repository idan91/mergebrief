# BRIEF-114 — Test hygiene: PGlite setup amortization + QA-doc disposition triage

Status: planned 2026-08-02. Policy source: [ADR 0038 §2 + §11](../adr/0038-constraint-mesh-test-quality-gates.md).
Board ticket: BRIEF-114 (In progress).

## Goal

Kill the last known flake structurally (PGlite migration setup blowing
hook timeouts — made deterministic-slow by coverage instrumentation,
#205), and convert the three manual QA docs to the disposition-tag scheme
so the pre-release pass is a gates-index plus a shrinking residual.

## Locked decisions (do not relitigate)

- Flake policy (ADR 0038 §2): structural fix, no retries. The 20s
  `testTimeout` in `packages/persistence/vitest.config.ts` is the #205
  band-aid — this ticket lands the real fix and revisits that number.
- QA triage (ADR 0038 §11): every step in `docs/dev/pre-release-testing.md`,
  `docs/dev/brief-19-smoke.md`, `docs/dev/generator-smoke-recipe.md` gets
  exactly one tag — `automated: <gate>` (step deleted, pointer left),
  `manual-until: <ticket/trigger>`, or `manual-forever: <reason>`.
  `pre-release-testing.md` becomes: gates-that-must-be-green index +
  residual manual walkthrough. Stale "dev-db flake" text dies everywhere
  (it was never a dev-db issue — hermetic PGlite).
- Feeds BRIEF-36; does NOT redefine the release gate.

## Facts for implementation

- `packages/persistence/test/helpers.ts` `freshDatabase()`: new PGlite +
  full drizzle migration per call. `packages/persistence/src/testing.ts`
  `createPgliteHarness`: same pattern, consumed by 33 files across
  persistence/api/web tests.
- Amortization mechanism — implementer picks after a quick spike, in
  order of preference:
  1. **Migrate once, snapshot, clone**: run migrations on one instance,
     `dumpDataDir()` the migrated state, boot each test's instance via
     `PGlite.create({ loadDataDir })` — per-test isolation kept, migration
     cost paid once per process.
  2. Migrate once per suite file (`beforeAll`) + per-test truncation —
     only if (1) proves slower or unstable.
  Measure before/after (suite wall time with `--coverage`) and put the
  numbers in the PR body.
- Isolation invariant: tests must keep getting independent databases —
  any shared-state alternative is out.
- After the fix: try lowering persistence `testTimeout` back toward the
  vitest default; keep a raised value ONLY if coverage still demands it,
  with the measured reason in the config comment.
- Current gates for the triage's `automated:` pointers: per-package
  coverage floors in `pnpm test` (BRIEF-110), lint chain = oxlint +
  eslint sliver + knip + format:check + stylelint (BRIEF-111),
  `pnpm -r typecheck`. Not yet live: CI gates (`manual-until: BRIEF-37 +
  BRIEF-112`), Playwright (`manual-until: BRIEF-113`), eval presence
  check (`manual-until: BRIEF-112`). Eval harness itself: unchanged
  convention gate.
- Multi-account / draft-PR / real-GitHub-App steps: `manual-forever`
  with the reason spelled out.

## Git requirements (git-eng — mandatory)

- Branch `chore/BRIEF-114/test-hygiene` off main. Chunked commits:
  (1) PGlite amortization + timeout revisit, (2) QA-doc triage + flake
  text removal. No Co-Authored-By, no AI attribution.
- performance-reviewer on staged changes before each commit (≥80 → fix).
  This ticket is performance-shaped — the reviewer's opinion on the
  amortization matters; don't rubber-stamp.
- Stop before push; then the approved PR-ready flow (push, PR
  `[BRIEF-114] chore: ...`, fable-reviewer loop, hand to Idan).

## Specialist skills (mandatory)

- `typescript-eng`.

## Work shape — single PR (S effort)

Helper + harness rework ~100 LOC, docs diff ~300 lines. Two commits as
above. Run: Opus 5 subagent, main-thread sequential.

Gates: `pnpm -r test` (floors intact — coverage numbers must not move),
`pnpm lint`, `pnpm -r typecheck`, all exit 0. No eval-harness trigger.

## Out of scope

- Playwright/E2E anything (BRIEF-113).
- CI wiring (BRIEF-112).
- Speeding up suites beyond the migration amortization.
