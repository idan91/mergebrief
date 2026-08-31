# BRIEF-111 — Static constraints bundle: ESLint sliver, knip, strictness trio, prettier whole-repo

Status: planned 2026-08-02. Policy source: [ADR 0038 §7](../adr/0038-constraint-mesh-test-quality-gates.md).
Board ticket: BRIEF-111 (In progress).

## Goal

Mechanize the conventions oxlint cannot express, catch dead exports/deps,
tighten tsconfig, and end the prettier apps/web-only split — so convention
drift by agents or outside contributors fails `pnpm lint`, not review.

## Locked decisions (ADR 0038 §7 — do not relitigate)

- **ESLint sliver**: flat config, NON-type-aware, zero custom plugins.
  Carries only what oxlint can't: plain-`enum` ban
  (`no-restricted-syntax` on `TSEnumDeclaration`), extensionless imports
  (`import/extensions: never` class rule), exported const-map casing
  (SHOUT_CASE keys — naming-convention class rule; exact rule choice is
  implementation detail, but NO type-info-requiring config). Runs inside
  the `pnpm lint` chain after oxlint.
- **knip** in the lint chain (dead exports, unused deps, unreachable
  files) — serves the BRIEF-90 entry-barrel policy.
- **Strictness trio** in all package tsconfigs: `noImplicitOverride`,
  `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- **`noUncheckedIndexedAccess`: measure, then verdict** — count errors
  repo-wide; adopt + fix if manageable (guideline: fixes fit inside PR 1's
  LOC budget); otherwise record a park-with-measurement verdict in
  ADR 0038 §7 (one-line amendment). Either way the verdict is recorded.
- **Prettier whole-repo** `--check .` (root); stylelint stays web-only.
- Already covered elsewhere — do NOT add: madge (skip), publint (parked),
  zizmor/actionlint + freshness gates (BRIEF-112), lychee (BRIEF-117).
- Result-not-throw, entry-barrel policy, types-owner-first stay text-only.

## Git requirements (git-eng — mandatory)

- Two stacked branches/PRs, both `chore/BRIEF-111/*`, chunked commits,
  no Co-Authored-By, no AI attribution.
- **PR 1** `chore/BRIEF-111/static-constraints`: ESLint sliver + knip +
  strictness trio + NUIA verdict (+fixes if adopted). Semantic, reviewable.
- **PR 2** `chore/BRIEF-111/prettier-repo-wide`, branched off PR 1:
  prettier root config/scripts + the one-time mechanical reformat of
  everything outside apps/web. Pure-format by construction — `git diff -w`
  against its base should be near-empty outside config files; state this
  in the PR body. Merges after PR 1 (upstream-first; squash-stack
  realign per house workflow).
- Pre-commit gate: `performance-reviewer` on staged changes ≥80 → fix.
- Stop before push; PR-ready flow as approved for BRIEF-110 (push, PR,
  reviewer loop — medium+ iterate — then hand to Idan).

## Specialist skills (mandatory)

- `typescript-eng` — tsconfig semantics, lint-rule selection, repo TS
  standards.

## Facts to verify at implementation start

- oxlint↔ESLint overlap: the sliver must not re-report what oxlint
  already flags (keep rule set minimal; disable everything else).
- Whether `import/extensions`-class rule needs eslint-plugin-import vs
  import-x vs core alternative under flat config; pick the lightest that
  works non-type-aware.
- knip config for a pnpm workspace with entry barrels (`src/index.ts`
  exports map) + apps/web feature barrels (ADR 0037) — expect
  per-workspace `entry` config; `--treat-config-hints-as-errors` posture
  like Vitest's cohort example only if noise-free.
- Which packages already pass the strictness trio (likely most — count
  errors first; fixes expected small).
- Prettier: root config exists? apps/web has one — decide inherit vs
  hoist; `.prettierignore` must cover dist/out/coverage/generated +
  `pnpm-lock.yaml`.
- The 4 cli test files noted in #205 review as prettier-nonconformant
  get formatted in PR 2 like everything else.

## Work shape

**PR 1** (~semantic, target <500 changed LOC excluding lockfile):
1. (commit 1) ESLint sliver: root `eslint.config.js`, deps, `pnpm lint`
   chain wiring. Prove each rule bites (temp violation → red → remove).
2. (commit 2) knip: config + lint-chain wiring; fix/mark real findings it
   surfaces (expected: a few dead exports; large fallout → flag before
   proceeding).
3. (commit 3) Strictness trio across tsconfigs + fixes; NUIA measurement
   + verdict (+fixes if adopted; ADR amendment line if parked).

**PR 2** (mechanical): (commit 1) root prettier config + script + ignore;
(commit 2) `prettier --write .` fallout. No hand edits mixed in.

Run: Opus 5 subagent, sequential (PR 2 depends on PR 1 branch). Gates per
PR: `pnpm -r test`, `pnpm lint` (new chain), `pnpm -r typecheck` all
exit 0. No eval-harness trigger (no generation surfaces).

## Out of scope

- CI wiring of any of this (BRIEF-112).
- Custom lint rules of any kind (ADR: zero in-house plugins).
- Fixing knip/NUIA fallout beyond what fits the budget — overflow becomes
  explicit follow-up tickets, never silent scope growth.
