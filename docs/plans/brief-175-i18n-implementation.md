# BRIEF-175 — i18n implementation plan

Spec: `brief-175-i18n-spec.md`. 13 PRs in 6 subtasks. Stacked where dependent;
independent stacks may interleave. No generation-surface files are touched —
**no eval spend anywhere in this plan**.

## Mandates

- **git-eng** governs all git operations. Stacked PRs off main; squash-merge +
  `rebase --onto` realignment (repo standing workflow); HTTPS + gh helper.
  Chunked commits per logical unit. No Co-Authored-By trailers, no
  AI-attribution in PR bodies.
- **Reviewer gates per PR**: fable-reviewer on every branch diff;
  security-reviewer additionally on API-touching PRs (3, 4, 5, 7);
  performance-reviewer additionally on web-touching PRs (5, 7, 9–13).
  Findings ≥80 confidence: fix, re-stage, re-run until clean.
- **Specialist skills (mandatory)**: `typescript-eng` everywhere;
  `web-accessibility` on PRs 9–13; `impeccable` audit on PR 13 (rendered UI,
  screenshots measured before shipping).
- **Verification per PR**: owning package `typecheck` + `test` + repo-root
  `pnpm lint`; `apps/web build` on any isomorphic/server-only web change.
  CI path-filters — run dependents' suites locally when a consumed contract
  changes (api wire shapes: run web + cli suites locally).

## Subtask 1 — Foundations

### PR 1 `chore(logging): sanitizeErrorDetail + params redact paths` (~250 LOC)
`sanitizeErrorDetail` in packages/logging (first line + 300-char cap + URL
scrub) + tests; `REDACT_PATHS` += `params.<secretKey>`, `*.params.<secretKey>`.
Consumers migrate in their own PRs. Model: Opus 5, medium effort, main thread.

### PR 2 `feat(i18n): new package — catalog, registry, typing, pseudo, gates` (~600 LOC)
Package scaffold (`src/index.ts` barrel, `createI18n()`, `TranslationKey`,
`i18next.d.ts`); `locales/en.json` seeded with the 18 `errors.*` templates +
11 `generationError.*` templates; `locales.ts` registry; pseudo postProcessor;
QA gate tests (hard-fail mechanical + report-only completeness; pins scaffold —
api wording pin lands in PR 3); AGENTS.md + CLAUDE.md + README walkthrough;
CONTRIBUTING.md Translations section; root AGENTS.md bullet. 75% floor.
Model: Fable 5, high effort (package shape + typing wire are design-heavy),
main thread.

## Subtask 2 — Wire error contract

### PR 3 `feat(api): error-response contract module + first routes` (~700 LOC)
`error-response.ts` (code map, body union, code→status, English templates,
`errorJson`); export mirror-only English map; migrate auth.ts, pulls.ts,
reads.ts, repos.ts; wire i18n wording pin (en template == api line).
Model: Fable 5, high effort (taxonomy finalization at sites, security
collapses preserved), main thread. Security-reviewer.

### PR 4 `feat(api): migrate remaining routes to the contract module` (~600 LOC)
Remaining 11 route files; delete the 7 `errorJson` copies + 8 bare-`c.json`
patterns; uniform no-store on error paths. Mechanical against PR 3's template.
Model: Opus 5, medium, main thread. Security-reviewer.

### PR 5 `feat(web): ApiError code + kind-mirror migration` (~700 LOC)
`apiFetch` reads error bodies; `ApiError.code` (status-synthesized fallback);
`ApiErrorKind` → mirrored `ApiErrorCode` + `"malformed"`; Equals + vocab pins;
fold both `kindForStatus` copies; feature transports derive kinds from body
code; `pr-changed-since-read` recoverable copy. Model: Opus 5, high (touches
many transports; behavior-preserving), main thread. Security + performance
reviewers. Run web suite against api locally (path-filter hole).

## Subtask 3 — Generation-failure persistence

### PR 6 `feat(persistence,worker): GenerationFailureCode + typed markFailed` (~800 LOC)
Persistence: vocab + CHECK migration, `error_code`/`error_params` columns,
backfill-and-drop migration, `markFailed(target, failure)`, clear-both on all
error-clearing transitions, `sanitizeErrorDetail` adoption (drops local copy);
worker: `task/failure.ts` classifier, throw-site stamps, `PermanentJobError`
failure field + transient sibling. Model: Fable 5, high (migration +
classification correctness), main thread.

### PR 7 `feat(api,web): generation failure on the wire + FailedCard catalog render` (~500 LOC)
`GenerationSummaryView` errorCode/errorParams; web parser + vocab mirror +
pins; FailedCard renders `generationError.<code>` (+ `{{detail}}` on unknown,
plural attempts copy from catalog); catalog-completeness pin in web suite.
Model: Opus 5, medium, main thread. Security + performance reviewers.

## Subtask 4 — CLI render

### PR 8 `feat(cli): render wire codes via catalog with verbatim fallback` (~250 LOC)
Tolerant probe; known code → template + " (HTTP n)"; unknown → verbatim
`error`; i18n runtime dep. Model: Opus 5, medium, main thread (or parallel
subagent — independent of subtask 3).

## Subtask 5 — Web i18n runtime + externalization sweep

### PR 9 `feat(web): i18next wiring` (~400 LOC)
react-i18next provider, `createI18n()` consumption, navigator.language
default, localStorage persistence, fallback chain, `lang` attribute; lint rule
NOT yet enabled. Model: Fable 5, high (isomorphic/SSR wiring; run `build`),
main thread.

### PRs 10–12 `feat(web): externalization sweep` (3 × ~700 LOC)
~450 strings / 81 files chunked by feature area (10: pulls + installations;
11: brief + review; 12: conversation + tokens + shell/remainder). Each PR:
COPY maps → catalog keys, ~10 hand-rolled plural sites → `_one`/`_other`,
`toLocale*` sites → helper or template formatters. PR 12 flips
`eslint-plugin-i18next` on (jsx-only, tuned ignores). Model: Opus 5, medium;
sequential (shared en.json = merge-conflict surface; do NOT parallelize).
Performance reviewer each.

## Subtask 6 — Locale picker

### PR 13 `feat(web): header locale picker + dev pseudo entry` (~300 LOC)
Compact header picker (globe + native-name dropdown from the registry),
pseudo entry dev-only, keyboard + SR complete. Model: Fable 5, high;
impeccable audit + web-accessibility mandatory; render + measure screenshots
before shipping.

## Ordering

1 → 2 → {3 → 4 → 5} ∥ {6 → 7} ∥ 8(after 3) → 9 → 10 → 11 → 12 → 13.
PR 8 needs 2 + 3. PR 7 needs 2 + 6. PR 9 needs 2. Picker last (needs 9's
runtime + registry). watch-pr-stack babysits merges per standing workflow.
