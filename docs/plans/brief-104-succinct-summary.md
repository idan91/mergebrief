# BRIEF-104 — Succinct generated PR summary and changelog: implementation plan

Grill completed 2026-08-06 (wayfinder judged the ticket too small for a map).
Ticket: "Succinct generated PR summary and changelog" (BRIEF-104, Notion).
Target shape fixed by the BRIEF-134 close-out amendment; the BRIEF-134 stack
(#234–#237) is merged, so the capped-prose primitive this rides on is live.

## Locked decisions

1. **FE split retired in this ticket.** The ticket's "pure prompt change"
   claim was false: `docs/plans/brief-134-details-spec.md` retires the
   two-column `## Changelog` split when 104 lands ("single column always"),
   and the split branch still exists in `SummarySection`. This plan deletes
   it. The prompt KEEPS emitting the `## Changelog` heading — plain markdown
   semantics, rendered single-column for old and new artifacts alike.
2. **Delta prompt included.** `buildDeltaSystemPrompt` gets the same 1–3
   line lede + 1–3 bullet changelog constraint. The revision-narrative
   prompt already caps its overview at 1–3 sentences — untouched.
3. **Intent check succinctness, light touch.** Prefer the shortest verbatim
   quote span that carries the ask (quotes stay verbatim); item free text
   (`intent`) one sentence. No bucket-rule changes.
4. **Eval gate = full suite on the API provider** against the committed
   `anthropic:claude-opus-4-8` baselines (measured $9.70), report in the PR
   body; `--rebaseline` on main after merge. The claude-code subscription
   route was tested and abandoned for eval-scale runs (billing gotchas:
   see the "Harness adapters must guarantee the configured billing route"
   ticket). **Precondition: the Anthropic Console balance is currently
   negative — top up before the gate run.**

## Mandatory skills

- **git-eng** — ALL git operations (branching, commits, push, PRs) go
  through it explicitly. Requirements gathered 2026-08-06, recorded below.
- **typescript-eng** — repo TS rigor (strict, no `enum`/bare `as`, named
  exports, extensionless imports).
- **tdd** — test-first where a behavior changes: update/extend the failing
  pin before the prompt edit; characterization coverage before the FE
  deletion.

## Git requirements (git-eng, confirmed with Idan)

- Branches: `feature/BRIEF-104/succinct-prompt` and
  `feature/BRIEF-104/retire-split`. **Both base `main`** — the two PRs
  share zero files and have no code dependency (either merge order is
  safe: pre-104 artifacts render single-column under the cap). This
  deviates from the usual stacked flow deliberately; no realign churn.
- Chunked commits per logical unit; **performance-reviewer** on staged
  changes before every commit (findings ≥80 confidence: fix, re-stage,
  re-run until clean).
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- PR titles: `[BRIEF-104] feat: …` in Title Case. Ready for review (not
  draft). Push HTTPS via the gh credential helper.
- Review loop: subagent review (Opus-only per current quota ruling —
  `fable-reviewer` runs on Opus), medium+ findings iterate, Idan merges.

## PR 1 — `[BRIEF-104] feat: Succinct Summary And Changelog Prompt`

Scope: `packages/brief-core` only. Est. ~80–150 changed LOC in
`generation/prompt.ts` + test updates (prompt-snapshot churn rides along;
snapshots are pinned prose, reviewed as text).

1. **Full-brief builder** (`buildSystemPrompt`, the `summary` bullet in
   "What a brief contains"): replace the "(1) concise one-paragraph
   overview; (2) fuller what-it-does; (3) optional `## Changelog`" shape
   with: a **1–3 line lede** (no heading structure), then optionally
   `## Changelog` with **1–3 bullets** when the change warrants one.
   State the constraint as a hard cap, not a preference.
2. **Delta builder** (`buildDeltaSystemPrompt`, the delta `summary`
   bullet): same lede + bullet caps, keeping the "since the baseline"
   framing and the optional follow-up-commit changelog.
3. **Intent check section** (full-brief builder): add the light-touch
   lines — shortest verbatim span that carries the ask; one-sentence
   `intent` text. No changes to bucket semantics, routing, or the
   alarm-register rules.
4. **Tests first** (tdd): `prompt-snapshots.test.ts` pins prose
   byte-for-byte — update pins to the new wording as the red step;
   `prompt.test.ts` line-presence pins likewise. brief-core suite +
   typecheck + root lint.
5. **Eval gate** (convention, never CI): top up Console balance, then
   `pnpm -C tools/categorizer eval` (default provider; the CLI loads the
   repo `.env` itself). Full suite, compare against committed baselines,
   paste the report + scoping justification ("prompt-wide: summary shape
   moves every case") into the PR body. Regressions iterate on wording
   before any baseline talk. `--rebaseline` happens on main post-merge,
   not on the branch.

## PR 2 — `[BRIEF-104] feat: Retire The Two-Column Changelog Split`

Scope: `apps/web` only. Est. ~150–250 changed LOC, mostly deletions.

1. **Characterization first** (tdd): confirm/extend SummarySection tests
   covering single-column render with and without a `## Changelog`
   heading and the delta `DeltaContext` placement, so the deletion has a
   green target.
2. Delete `splitSummaryAtChangelog` (`features/brief/utils/viewModel.ts`)
   + its describe block in `viewModel.test.ts`.
3. `SummarySection.tsx`: drop the split branch — always
   `<Markdown content={brief.summary} />`, `DeltaContext` renders on the
   single path; remove the `data-summary-split` attribute and the BRIEF-4
   comment; update the component doc comment.
4. `SummarySection.module.scss`: remove `[data-summary-split]`,
   `.summaryColumns`, `.summaryLead`, `.summaryAside` rules.
5. apps/web typecheck + test + lint + build (build required — repo rule
   for anything near server/isomorphic graphs; cheap insurance here).
6. **Render before shipping** (standing feedback): compile, screenshot
   via playwright against a changelog-bearing brief and a delta brief,
   MEASURE the single-column result; visual PRs get an /impeccable audit
   on the rendered UI. Screenshots in the PR body.

## Execution

- **Model/effort**: both PRs are execution against locked decisions —
  Opus-class in the main thread, sequentially (PR1 then PR2; they're
  independent, but sequential keeps the eval run and its possible wording
  iteration unconfounded). No subagent fan-out — the work is small and
  the review loop already uses subagents.
- **Prompt-wording iteration risk** (PR1): if the eval shows a property
  regression, the fix is wording, not scope — iterate within the PR;
  never lower a baseline to absorb a drop.
- **Out of scope**: revision-narrative prompt; intent-check bucket rules;
  the harness billing-route ticket; any two-column layout replacement
  (single column IS the design, per the BRIEF-134 spec).

## Post-merge

1. On main: full-suite `--rebaseline`, review the diffs (BRIEF-85 lesson:
   a scoped rebaseline re-measures every property in the case — diff the
   files, don't trust intent), commit the baselines.
2. Close BRIEF-104 in Notion with a pointer to both PRs + the eval report.
