# 0038 — Constraint mesh: automated test & quality gate policy

Status: accepted (2026-08-02). Decided on the BRIEF-82 wayfinder map
(eleven decision tickets, all closed 2026-08-02); grounded in the
primary-source cohort survey `docs/plans/brief-82-constraint-mesh-survey.md`
(tRPC, Zod, Hono, Vitest, Astro + esbuild, ripgrep, ruff, FastAPI — every
claim cited at pinned SHAs). Implementation lands via the board tickets
filed at close-out; per-ticket plan docs follow the init-plan checklist at
implementation time.

## Context

Development here is agent-executed with OSS contributors expected
post-cutover; the counterweight is a dense mesh of automated checks so a
wrong change is caught mechanically, not by reviewer vigilance. Before this
ADR the mesh was: vitest suites per package (hermetic — PGlite in-memory,
including api route-level tests against the real Hono app), oxlint
type-aware with most repo conventions already mechanized, prettier/stylelint
on apps/web only, hand-rolled path-filtered CI (dependents NOT run on
dependency changes — the BRIEF-23 incident class), and a live-spend eval
harness convention-gated outside CI. No coverage, no E2E, no mutation, no
BDD, no flake policy beyond prose.

Standing rules fixed at charting:

- **Survey is evidence, not ceiling** — verdicts are "best for this repo";
  cohort norms calibrate, deviations state their reason.
- **Contributor-safety**: gates must hold on fork PRs, not just for agents.
- **Live-spend surfaces never enter CI** — presence checks and convention
  gates only.
- Every adopted layer states its runtime cost; gates must not slow the
  agent loop more than the bug rate justifies.

## Decision — layer verdicts

### 1. Test pyramid (adopted shape)

Unit + hermetic integration (persistence/api/web-server, PGlite) + API band
(= the existing `packages/api` suite, declared as such) + browser E2E
(below) + eval harness (live-spend, convention-gated). **No tier-labeling
taxonomy** — package boundary is the tier boundary; a test earns
segregation only when it needs different runtime handling. **Gherkin/BDD:
rejected** (0/9 cohort; no non-code-reading audience exists). Type-level
tests and doc-example tests: parked (triggers: a package published for
library consumption / runnable doc examples).

### 2. Flake policy

**No auto-retries at unit/integration layer — a flake is a bug**, fixed
structurally (serialize, raise the specific timeout, pin the cause).
Quarantine (explicit warn-don't-fail carve-out + linked ticket) is reserved
for external nondeterminism; currently zero cases. The known PGlite
`freshDatabase` 5s-hook-timeout flake gets a structural fix and exits the
QA docs. Browser layer is the sole retry exception: Playwright
`retries: CI ? 2 : 0`, `trace: 'on-first-retry'`.

### 3. Coverage

**Hard floor: 75% lines per package** via `@vitest/coverage-v8`, thresholds
committed in each package's vitest config; lines only in v1 (no
branch/function thresholds). Packages measured under 75% at implementation
get a temporary floor at their measured level plus a catch-up ticket.
Exclusions: generated artifacts (`drizzle/` output, `routeTree.gen.ts`,
`*.gen.*`), type-only files, re-export-only entry barrels, vitest defaults;
per-file `v8 ignore` requires a stated reason. **Gate location: baked into
`pnpm test` itself** (`vitest run --coverage`) — identical wall locally, in
agent loops, and in CI. Runtime cost: ~10–20% suite time. Ratchet-only
(auto-rising floors) was considered and declined for now — it is the
natural upgrade if the hard floors go stale.

### 4. Browser E2E (Playwright)

Boundary: **reviewer surface only** — real web server, real browser; no
worker, no webhook, no live spend. Phased: **v1 = unauthenticated
dummy-brief suite** (fixture brief via the local-brief path; rendering,
spans, conversation interactions, thread-jump DOM behavior; axe-core
assertions gating serious/critical). **v2 = seeded-session DB-backed
slices** (real loader, compare bar, submit-to-stub, self-review states) —
ticketed, build trigger: first regression v1 can't see or the v1-gate
decision. Full-loop E2E (compose + replayed signed webhook + a
fake generator adapter, which does not exist yet) parked with trigger:
first webhook-spine regression the piecewise integration tests miss.
Chromium only, single worker, runs on fork PRs (fully hermetic). Recorded
caveat: the fixture path diverges from the DB loader path — v1 proves the
rendering/interaction layer only.

### 5. Mutation testing (Stryker)

**Periodic diagnostic, never a gate** (0/9 cohort adoption; adopted anyway
as the mesh's only vacuous-test detector — a 75% floor is satisfiable by
assertion-free tests, the known agent failure mode). Scope: pure-logic
packages only (brief-core validators/salvage, repo-config, categorizer
domain). No kill-rate number — the survivor list is the deliverable; each
survivor becomes a test fix or a recorded acceptable. One-shot audit at
implementation, then a pre-release convention step. Never per-PR CI.

### 6. Property-based testing (fast-check)

Adopted on three untrusted-input surfaces: `packages/github`
payload/webhook parsers (arbitrary JSON never throws, always `Result`,
idempotent re-parse), brief-core validators/salvage (salvage never throws;
its output always passes the validator), repo-config parsing (arbitrary
input → `Result`, defaults applied). Lives inside the existing vitest
suites — no new tier, `numRuns: 100`, failures print a reproducing seed
(compatible with the no-flake policy). Not applied to I/O packages or UI.

### 7. Static constraints

Most conventions were already mechanized in `.oxlintrc.json` (no bare `as`,
named-exports-only, no-cycle, no-`any`, logging seam as path-scoped
`no-console`). Added: **a minimal ESLint sliver** (flat config,
non-type-aware, zero custom plugins — 0/9 cohort write in-house rules)
carrying only what oxlint cannot express: `no-restricted-syntax` banning
`TSEnumDeclaration`, `import/extensions: never`, naming-convention for
exported const-map casing. **knip** adopted (dead exports / unused deps —
mechanizes the BRIEF-90 barrel policy); madge skipped (no-cycle covered);
publint parked (trigger: first npm publish). TS strictness:
`noImplicitOverride` + `noImplicitReturns` + `noFallthroughCasesInSwitch`
adopted now; `noUncheckedIndexedAccess` measured at implementation and
adopted if fallout is manageable; `exactOptionalPropertyTypes` skipped.
**Prettier goes whole-repo**; stylelint stays web-only. **zizmor +
actionlint** adopted on workflows. **Generated-artifact freshness gate**
adopted (regenerate `routeTree.gen.ts` + drizzle state in CI, fail on
porcelain diff). Result-not-throw, entry-barrel policy, and
types-owner-first remain prose — no tool expresses them honestly.

### 8. CI structure

**pnpm-native affected filters** (`--filter "...[origin/main]"`) replace
the hand-rolled grep filters — changed packages plus all dependents run,
from the real workspace graph. This **absorbs BRIEF-26**. Turbo rejected
(we need the graph, not the build cache). Workflow-file and lockfile
changes trigger the full suite. A single **`required-checks-passed`
aggregation job** becomes the sole branch-protection check. **Fork-safety
bundle**: `permissions: {}` workflow-level with minimal per-job grants,
`persist-credentials: false` on every checkout, SHA-pinned actions with
version comments, `pull_request_target` banned for build/test. Fork PRs
run the full hermetic wall (lint, typecheck, all suites); the eval harness
never runs on forks. Test artifacts upload on failure only (7-day
retention). **Everything CI-side lands with BRIEF-37** (CI billing) —
designed now, live then.

### 9. Supply chain

`pnpm audit --prod --audit-level=high`, **blocking**, scoped to
lockfile-touching PRs plus a weekly scheduled run; noise pinned via
`pnpm.auditConfig.ignoreCves` with per-entry comments. (Survey honesty:
0/9 cohort gate on audit; adopted per the charting decision, scoped to
keep noise near zero.) Renovate parked — solo-scale norm is
freeze-and-pin; trigger: OSS cutover / regular external contributors.
Heavier SAST/secret-scanning stays on the existing security-audit ticket.

### 10. Test health

No flake-tracking infrastructure (0/9 cohort have any) — a flake becomes a
ticket the day it is seen. **Weekly scheduled full-suite cron** (everything,
no path filters) as the drift detector. Coverage trend: parked entirely
(trigger: the ratchet upgrade). **Eval presence check adopted, blocking**:
a CI job triggered only by generation-surface paths that fails unless the
PR body contains the eval report per the existing convention — body-grep
only, never runs the eval.

### 11. QA procedure ratchet

Every step in `pre-release-testing.md`, `brief-19-smoke.md`,
`generator-smoke-recipe.md` gets one disposition tag: `automated: <gate>`
(deleted from the manual pass), `manual-until: <ticket/trigger>`, or
`manual-forever: <reason>`. The pre-release doc becomes a gates-index plus
a residual manual walkthrough that shrinks as triggers fire. Feeds
BRIEF-36 without forking the release-gate definition.

### 12. Long-tail verdicts

Perf/benchmark gates parked (trigger: first real perf regression reaching a
user surface). Bundle-size gates parked (trigger: measurable page-load
complaint or a published client package). Type-coverage % rejected
outright. Commit-message/PR-title lint parked (trigger: contributor commit
noise hurting history use). **lychee link-check on `docs/**` adopted**
(weekly + docs-touching PRs); `typos` skipped.

## v1 release gate

Blocking v1 (mesh in place before OSS contributors): coverage floors ·
static-constraints bundle · CI overhaul (incl. fork safety, audit,
zizmor/actionlint, freshness gates, weekly cron, eval presence check;
prereq BRIEF-37) · E2E v1 dummy-brief suite · PGlite flake fix + QA-doc
triage. Post-v1 ratchets: fast-check surfaces · mutation one-shot +
pre-release step · lychee · E2E v2 (trigger-gated).

The dividing line: v1 = everything that stops wrong changes landing;
post-v1 = everything that deepens test quality.

## Consequences

- `pnpm test` gets slower (~10–20%) and stricter everywhere; the same wall
  applies to agents, maintainer, CI, and forks — no split-brain gates.
- BRIEF-26 closes as absorbed; BRIEF-36's manual pass shrinks to the
  gates-index + residual walkthrough; the eval-harness convention becomes
  mechanically enforced.
- New standing costs: ESLint sliver + knip + lychee + zizmor maintenance
  (all config-only), Playwright infra, weekly cron minutes.
- Every park in this ADR carries a revisit trigger; re-litigating a verdict
  without its trigger firing needs new evidence.
