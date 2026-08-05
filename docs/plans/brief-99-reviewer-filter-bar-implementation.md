# BRIEF-99 — Reviewer filter bar: implementation plan

Decisions locked in `docs/plans/brief-99-reviewer-filter-bar.md` @ bb602de4 — read
it first; do not relitigate anything in its Decisions section.

## Models and invocation

**All agents run Opus 5 — implementation and reviewers alike. No Fable anywhere**
(usage constraint, 2026-08-05). Reviewer subagents (`fable-reviewer`,
`performance-reviewer`, `security-reviewer`) get an explicit `model: "opus"`
override when spawned.

- PR 1 (logic): Opus 5, effort high — reduction/faceting semantics are subtle.
- PR 2 (UI): Opus 5, default effort — chrome follows existing precedent.
- Invocation: sequential in the main thread (PR 2 depends on PR 1). Reviewer
  agents as parallel subagents at each gate.

## Mandatory skills

- `git-eng` — ALL git operations go through it explicitly. Requirements below.
- `typescript-eng` — repo TS standards (no enum, no bare `as`, named exports,
  extensionless imports).
- `tdd` — filter predicate, latest-per-reviewer reduction, and faceted counting
  are built test-first.
- `web-accessibility` — chips are `aria-pressed` toggle buttons; sr-only count
  context; follow AttributeJumpRail precedent.
- `/impeccable` audit on rendered UI before PR 2 is marked ready (standing rule
  for visual PRs).

## Git requirements (git-eng)

- Stacked branches off `main`: `feature/BRIEF-99/filter-logic` →
  `feature/BRIEF-99/filter-bar-ui` (PR 2 based on PR 1's branch).
- Commits: chunked — commit per logical unit.
- Pre-commit gate: `performance-reviewer` + `security-reviewer` in parallel on
  staged changes before EVERY commit (both with `model: "opus"`); findings with
  confidence ≥ 80 get fixed and re-reviewed until clean.
- No `Co-Authored-By` trailers; no AI attribution in PR descriptions.
- PR titles: `[BRIEF-99] feat: <Title Case>`. Squash-merge stack realignment per
  the standing `rebase --onto` recipe; never plain-pull a rebased branch.
- Idan merges; PRs go up ready (not draft) after review gates pass.

## PR breakdown

### PR 1 — filter logic + URL state (~350 LOC incl. tests)

Branch `feature/BRIEF-99/filter-logic`. Pure logic, no visible UI change.

1. `features/conversation/utils/filter.ts` (TDD):
   - `FilterState` type: verdict set, reviewer set, recency flag. Parse/serialize
     to URL search params (`replace` navigation; both BriefScreen routes).
     Param naming mirrors `compareState.ts` helpers.
   - Latest-per-reviewer reduction: last-seen per author login; `submittedAt`
     optional → array-order fallback.
   - Predicates: review (verdict AND reviewer families; OR within, AND across;
     empty family inactive), thread (author = first comment author), PR comment
     (author). DISMISSED matches no chip.
   - Faceted counts: computed after recency reduction, under the other family's
     selection. Human primary + bot secondary per verdict state; zero-count
     states excluded.
   - Hidden-inline-threads count for the indicator pill.
2. URL-state helpers wired (no consumers yet) — mirror `compareState.ts` shape.
3. Tests: `filter.test.ts` covering reduction ordering, faceting under both
   families, empty-family semantics, DISMISSED exclusion, param round-trip.

### PR 2 — filter bar UI + digest & inline wiring (~700 LOC incl. tests)

Branch `feature/BRIEF-99/filter-bar-ui` on top of PR 1.

1. `FilterBar` component (two rows) above the digest in `ConversationSection`:
   - Row 1: verdict chips, human primary count + muted bot secondary
     ("Approve 2 · 1 bot", `botTag` styling). Recency toggle (default ON).
   - Row 2: reviewer chips — humans, divider, bots — All/None at row end.
   - Hidden-threads count pill when inline threads are filtered out.
   - Chips: `<button aria-pressed>`, sr-only context, `rows.module.scss`
     chip/`count` classes + AttributeJumpRail patterns.
2. Wire filtering: verdict strip, thread rows/groups, PR comments in
   `ConversationSection`; inline threads via `buildInlineThreads` path.
3. Empty state: muted "No activity matches filters" + inline clear link.
4. Tests: `ConversationSection.test.tsx` additions (chip toggling, counts,
   empty state, URL round-trip), inline-thread filtering test.
5. `/impeccable` audit on rendered UI (both light/dark), fixes applied, then PR.

## Sequence

1. Session start: load decisions doc + this plan; `git-eng` branch setup.
2. PR 1 test-first; gates; push; PR up.
3. PR 2 on top; gates + impeccable; push; PR up.
4. Idan reviews/merges; stack realignment per recipe on PR 1 squash-merge.
