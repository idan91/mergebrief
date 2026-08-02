# BRIEF-112 — CI overhaul: affected filters, aggregation, fork safety, new gates

Status: planned 2026-08-02. Policy source: [ADR 0038 §8–§10](../adr/0038-constraint-mesh-test-quality-gates.md).
Board ticket: BRIEF-112 (In progress). CI is live (BRIEF-37 moot, confirmed 2026-08-02).

## Goal

Close the BRIEF-23/26 dependents-not-run hole with graph-aware filtering,
make fork PRs safe by construction, and land the adopted mesh gates that
live in CI (audit, workflow lint, freshness, weekly cron, eval presence
check). The PRs verify themselves: `pull_request` workflows run from the
PR branch, so green checks on each PR ARE the live test.

## Locked decisions (ADR 0038 §8–§10 — do not relitigate)

- **Affected filtering via pnpm's graph**: `pnpm --filter "...[<base>]"`
  selects changed packages + all dependents. Workflow-file or lockfile
  changes ⇒ run everything. No turbo.
- **One aggregation job** `required-checks-passed` (`if: always()`, fails
  unless every needed job is success or skipped) — becomes the sole
  required check.
- **Fork bundle**: `permissions: {}` at workflow level (minimal per-job
  grants), `persist-credentials: false` on every checkout, every action
  SHA-pinned with a version comment, `pull_request_target` banned.
- **Audit gate**: `pnpm audit --prod --audit-level=high`, blocking, on
  lockfile-touching PRs + weekly schedule; `pnpm.auditConfig.ignoreCves`
  with per-entry comments for noise.
- **zizmor + actionlint** on `.github/workflows/**`.
- **Freshness gate**: regenerate `routeTree.gen.ts` + drizzle migration
  state, fail on `git status --porcelain` diff.
- **Weekly full-suite cron**: `pnpm -r test` + `pnpm lint` +
  `pnpm -r typecheck`, no filters.
- **Eval presence check**: job triggered only by generation-surface paths
  (root CLAUDE.md list: `packages/brief-core/src/generation/prompt.ts`,
  output schema, validators/salvage, repo-config injection,
  output-affecting adapter defaults) that fails unless the PR body
  contains an eval report/justification section. Body-grep via the GitHub
  API; NEVER runs the eval (live spend).
- Artifacts: failure-only uploads, 7-day retention.

## Git requirements (git-eng — mandatory)

- Two stacked PRs, chunked commits, no Co-Authored-By, no AI attribution:
  - **PR 1** `chore/BRIEF-112/ci-affected-filters`: rewrite `ci.yml` —
    affected filtering, aggregation job, fork bundle, failure-only
    artifacts. Keeps existing per-package check semantics (test /
    typecheck / lint / web build) — same coverage, new selection.
  - **PR 2** `chore/BRIEF-112/ci-gates` (stacked on PR 1): new workflows —
    `audit.yml`, `workflow-lint.yml` (zizmor + actionlint),
    `freshness.yml`, `weekly.yml`, `eval-presence.yml` (or fold small
    ones sensibly; each workflow self-contained and SHA-pinned).
- performance-reviewer before each commit (≥80 → fix).
- Stop before push; then the approved PR-ready flow. THE PRS' OWN CI RUNS
  ARE THE ACCEPTANCE TEST — after push, watch `gh pr checks` and iterate
  until green before handing to review.

## Specialist skills (mandatory)

- `typescript-eng` for any script glue (prefer plain workflow YAML +
  existing pnpm scripts; no new script files unless a step is genuinely
  unexpressible inline).

## Facts to verify at implementation start

- Current `ci.yml` (582 lines): per-package jobs with hand-rolled
  `git diff` greps — map each existing job to its affected-filter
  replacement; nothing currently covered may lose coverage.
- `pnpm --filter "...[ref]"` semantics on a PR: needs the merge base
  locally — set `fetch-depth: 0` or compute an explicit base SHA; verify
  the filter output on a probe diff locally before wiring.
- Whether `pnpm -r --filter` composes with per-package scripts used today
  (`test`, `typecheck`, apps/web `build`/`lint`).
- zizmor invocation (pinned action vs uvx) and actionlint (pinned action
  vs binary) — pick SHA-pinnable, tokenless options; run both locally on
  the rewritten workflows BEFORE pushing (they lint the thing being
  changed).
- Freshness: exact regen commands (`routeTree` via the web dev tooling;
  drizzle via `drizzle-kit generate` in check mode or porcelain diff) and
  their runtime cost.
- Eval presence: exact path list from root CLAUDE.md; marker to grep for
  in the PR body (the convention's report block / explicit skip
  justification — define the accepted markers in the job and document
  them in the job's name/summary output).
- `pnpm audit` current output on the repo (baseline noise → ignoreCves
  entries, each commented).

## Work shape

PR 1 (~1 file rewrite, well under ceiling): commits = (1) affected-filter
core + aggregation, (2) fork bundle + SHA pins + artifacts.
PR 2 (new workflows, small files): commits = (1) audit + workflow lint,
(2) freshness + weekly cron, (3) eval presence check.

Run: Opus 5 subagent, sequential.

Gates: local `pnpm lint` / `pnpm -r typecheck` / `pnpm -r test` untouched
by CI changes but run once anyway; zizmor + actionlint locally on every
workflow file; after push, both PRs' checks green.

## Manual step for Idan (checklist — goes in PR 1 body)

- Branch protection: switch required checks to the single
  `required-checks-passed` job after PR 1 merges (Settings → Branches).

## Out of scope

- Playwright job (BRIEF-113 adds it; the aggregation job picks it up then).
- Renovate (parked; trigger recorded in ADR).
- Any change to what the per-package suites test.
