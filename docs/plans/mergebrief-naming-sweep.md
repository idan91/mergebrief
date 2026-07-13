# BRIEF-33 — MergeBrief Naming Sweep (Implementation Plan)

Ticket: BRIEF-33 (Notion, "chore: MergeBrief naming sweep"). Effort: S. Single PR.

Pre-release rename sweep: user-visible strings where "Brief" names the **tool** move to
**MergeBrief**. Scoping decisions (2026-07-13, recorded on the ticket) already shrank this
from the original M: internal identifiers are verified clean, and "Brief" survives as the
artifact noun.

## Decisions already made (do not re-litigate)

- **"Brief" stays as the artifact noun.** MergeBrief = the tool, Brief = the generated
  document. "Previous Brief", "Full Brief", "Turn a PR into a Brief" all stay.
- **Decision test per occurrence:** if "MergeBrief" reads correct in place, it's the tool —
  rename. If it refers to the generated document — keep.
- **Out of scope:** repo name, `BRIEF-` ticket prefix, package.json names (`code-review`
  root, `@code-review/web`, bare workspace names). OSS launch cutover owns all of these.
- **Do not touch internal identifiers:** env vars / config keys / cache dirs are already
  `MERGEBRIEF_*`-clean; code identifiers (`Brief` type, `previousBrief`, `briefId`,
  `features/brief/`, CSS classes, test names) use the artifact sense and stay.

## Git workflow (git-eng — mandatory for all git operations)

- Branch off `main`: `chore/BRIEF-33/naming-sweep`.
- **Single commit at the end** (user-confirmed). No pre-commit review agents
  (user-confirmed: none).
- No `Co-Authored-By` trailers; no AI-attribution lines in the PR description.
- PR via `gh pr create`, base `main`, title: `[BRIEF-33] chore: MergeBrief Naming Sweep`.
  Description uses the standard Overview / Changelog structure (no template in repo).
- Ask before push whether draft or ready.

## Specialist skills (user-confirmed)

- **typescript-eng** — mandatory. (tdd explicitly not adopted: no behavior change; only
  string-expectation updates in existing tests.)

## Part / PR breakdown

One part, one PR. Estimated diff: well under 100 LOC (a handful of string literals plus
matching test expectations) — no split triggers apply.

**Model + effort + invocation:** Sonnet, medium effort, sequential in the main thread.
No subagents, no Fable: the judgment call (tool vs artifact sense) is already codified as
a mechanical test on the ticket. No reviewer loop; Idan reviews the PR directly.

## Implementation steps

1. Branch `chore/BRIEF-33/naming-sweep` off up-to-date `main`.
2. Rename the two known tool-sense strings (GitHub-published attribution):
   - `apps/web/src/features/review/state.ts:138` — `"Reviewed with Brief / review — …"`
     → `"Reviewed with MergeBrief / review — …"`
   - `apps/web/src/features/review/submit.ts:144` — `"Reviewed with Brief — …"`
     → `"Reviewed with MergeBrief — …"`
   Update the test expectations that pin them (at minimum
   `apps/web/src/features/review/useReviewSubmit.test.tsx:125`; grep for
   `"Reviewed with"` across tests).
3. **Own sweep — the two strings above are rule illustrations, not the work list.**
   Grep the repo (`Brief`/`brief`, case-insensitive, excluding node_modules) and apply the
   decision test to every user-visible string: FE labels, headings, meta/titles, error
   copy, CLI output/help text, comment/entry templates. Rename tool-sense hits only.
   Check `apps/web` HTML title / meta specifically — earlier scan found no `<title>`, so
   confirm where the app name is set (router head config or server render) and align it.
4. Acceptance criterion (from ticket): final grep-verify pass — every remaining
   `Brief` hit must be (a) artifact-noun sense in user-visible copy, (b) a code
   identifier, or (c) inside the explicit exclusions. Any tool-sense hit = sweep not done.
5. Run the affected package suites locally (`apps/web` at minimum; CLI/worker if their
   strings changed) — CI is path-filtered and will not cover cross-package string
   expectations.
6. Lint per branch; judge by exit code.
7. Single commit, push, PR per the git workflow section. Move ticket to In review.
