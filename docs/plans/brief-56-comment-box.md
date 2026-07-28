# Plan — BRIEF-56: Improve comment box (shared MarkdownTextarea + parity gaps)

> Status: **LOCKED — grill closed 2026-07-28; implementation not started.**
> Ticket: Notion BRIEF-56 "Improve comment box".
> Research: child page of the ticket (2026-07-25) — GitHub-baseline gap table.
> Grounding: BRIEF-44 placement convention (global vs co-located, merged
> #158–#171), FE decomposition #173–#177 (ReplyComposer now at
> `features/conversation/components/ThreadRowView/ThreadDetail/ReplyComposer/`),
> BRIEF-25 posting posture, ADR 0016 (no Issues permission).
> Spawned tickets (filed 2026-07-28): resolve/unresolve threads (Next);
> collaborators endpoint for mentions (Next, Roadmap V1).

## Goal

One markdown composing surface instead of two unrelated ones: today
CommentComposer (draft path) and ReplyComposer (conversation path) share no
code, and ReplyComposer writes markdown blind — no toolbar, tabs, preview, or
shortcuts. BRIEF-56 extracts a shared MarkdownTextarea, fixes the list-editing
defects the ticket named, and closes the cheap parity gaps against GitHub's
composer — all pure `apps/web`, zero new scopes, zero backend.

## Locked decisions (grill 2026-07-28)

1. **"Fix list items" means three things:** Enter continues the current list
   item (Shift+Enter inserts a plain newline as the escape hatch); the
   numbered-list toolbar button on a later row continues numbering
   contextually, never restarts at 1; both list buttons get real icons
   (today: literal "List" / "1." text).
2. **Hand-rolled shared component** — reuse the existing selection-math in
   `useCommentComposerFacade`. Tripwire: if custom formatting logic balloons
   past the current button set + list behaviors, switch to
   `@github/markdown-toolbar-element` mid-implementation instead of accreting.
3. **Resolve/unresolve is out** — separate ticket (only backend-touching
   item). Filed.
4. **Posted comments stay read-only locally** (BRIEF-25 posture stands;
   "View on GitHub" covers edits). Revisit trigger: reaching for
   edit-on-GitHub more than rarely after posting from brief.
5. **Dead "Apply suggestion unavailable in mockup" button is removed.** The
   suggestion diff card stays; no disabled control advertising an unbuilt
   flow.
6. **Composer body font → sans.** Mono survives only inside code fences and
   the suggestion diff card. Comments are prose-first; code-first identity
   lives in the diff table.
7. **Mentions: participants-seeded v1.** Candidate pool = conversation
   participants + PR author (already in the conversation payload — no
   backend). Collaborators endpoint is a separate v1 ticket; build the
   autocomplete so the candidate source widens without rework.
8. **ReplyComposer stays post-immediately.** No local draft-then-post mode
   (GitHub's create-review can't batch replies; existing race-safe typed-text
   persistence covers come-back-later). Keep the immediate-post labeling
   honest in the UI.
9. **Scope cut ratified** — see PR breakdown. Parked: uploads (no public
   GitHub API), suggestion-apply (needs Contents: write), PR/file-level
   comments (Issues permission, ADR 0016), emoji autocomplete, syntax
   highlighting in rendered markdown, saved replies, reactions, edit history.
   Ours-is-fine, untouched: error-state model, draft/post-now transport, no
   optimistic updates, 65k caps.

## Placement (BRIEF-44 convention)

`MarkdownTextarea` is multi-consumer ⇒ global: `apps/web/src/components/
MarkdownTextarea/` — component + `.module.scss` + `utils.ts` (closure-free
selection/list math, unit-tested directly) + facade hook. `MarkdownPreview`
moves/merges under it (currently `features/review/components/` but becomes
shared via the component). Consumers keep only product wiring: what "submit"
means, labels, error plumbing.

## Safety net

Characterization harness covers the split surface (`apps/web/src/
characterization/` — briefScreen, readThrough, comparisonStateMatrix);
CommentComposer + CommentThread have unit tests. Selectors are data-attr
based (verified June lesson). PR 1 is behavior-preserving for
CommentComposer except where a decision says otherwise (icons, a11y).

## Git requirements (git-eng — mandatory for ALL git operations)

- Start from up-to-date `main` (current local branch
  `feature/brief-41-entry-comment-reping` is stale — #178 merged).
- Stacked branches, one per PR: `feature/BRIEF-56/<slug>`, each based on the
  previous until merge; squash-merge stacks need `rebase --onto` per merge
  (see memory `git-push-workflow`).
- **Chunked commits** after each logical unit.
- **Pre-commit gate on every commit:** `performance-reviewer` on staged
  changes; findings ≥80 confidence → fix, re-stage, re-run until clean.
- **No `Co-Authored-By` trailers; no AI-attribution in PR descriptions.**
- Push + ready PRs, titles `[BRIEF-56] feat: …` per git-eng format.
- Lint per branch by exit code (never grep-for-error).

## Mandatory skills

- `git-eng` — every git/gh operation.
- `typescript-eng` — all TS work (strict, no enum, named exports, Result at
  boundaries).
- `web-accessibility` — toolbar/tabs/label/combobox semantics (PRs 1, 2, 4).

## PR breakdown

Five stacked PRs, sequential in the main thread (each depends on the shared
component landing first). Review loop: `fable-reviewer` agent, one pre-merge
round per PR on the branch diff; medium+ findings iterate, low/nitpick-only
= clean with a note in the PR body. Idan merges.

### PR 1 — Shared MarkdownTextarea + CommentComposer adoption (~650–850 LOC)

`[BRIEF-56] feat: Shared MarkdownTextarea — Extraction And CommentComposer Adoption`

1. New `components/MarkdownTextarea/` per placement above: textarea +
   Write/Preview tabs + toolbar + existing shortcut set (Cmd+B/I/K), built
   a11y-correct from the start — labeled textarea, `role="toolbar"` with
   roving tabindex, icon buttons with aria-labels + shortcut tooltips, real
   tabs semantics, associated error slot. Icons replace text labels
   (including the two list icons — decision 1c).
2. Selection-math moves to `MarkdownTextarea/utils.ts` (closure-free, unit
   tested); facade hook slims to product wiring.
3. Adopt in CommentComposer; behavior-preserving otherwise (characterization
   + existing unit tests stay green, updated only for icon/a11y markup).
4. Remove the dead Apply-suggestion button from MarkdownPreview (decision 5).

Invocation: **main thread, Fable 5, high effort** — component API + a11y
semantics are the design-heavy core of the whole ticket.

### PR 2 — ReplyComposer + draft-edit adoption; visual unify (~400–550 LOC)

`[BRIEF-56] feat: One Composer Surface — Reply And Draft-Edit Adoption`

1. ReplyComposer adopts MarkdownTextarea (worst parity gap closes); its
   stronger label/aria-invalid/aria-busy patterns fold into the shared
   component where not already there. Immediate-post labeling stays explicit
   (decision 8).
2. CommentThread draft-edit textarea adopts it.
3. Visual unify: sans body font (mono in fences/suggestion card only — needs
   MarkdownPreview/`Markdown` check), 2px token-colored focus ring, composer
   hard-coded hexes (#101014, #09090b, #15151a, #303038) → `tokens.scss`,
   footer strip "Markdown is supported", autosize (`field-sizing: content`
   or measured fallback, max-height + `overflow-y: auto`, manual resize
   kept). Verify toolbar wrap at narrow widths.

Invocation: **main thread, sequential after PR 1, Opus 5, medium effort** —
execution-heavy adoption + styling; the design calls are already made.

### PR 3 — List semantics + shortcut set (~350–500 LOC)

`[BRIEF-56] feat: List Continuation And Composer Shortcuts`

1. Enter continues the current list item (bulleted/numbered/task); empty
   item + Enter terminates the list (GitHub behavior); Shift+Enter always
   plain newline. Tab/Shift+Tab indent/outdent inside lists.
2. Numbered-list button numbering is contextual to preceding lines
   (decision 1b); multi-line selection behavior covered by tests.
3. Shortcuts on all three consumers: Cmd/Ctrl+Enter submits the primary
   action; Cmd+E inline code; Cmd+Shift+P tab toggle; Cmd+G suggestion
   (CommentComposer only); Escape consistency (cancel edit mode, clear/blur
   reply — window-listener pattern already exists).
4. Heavy unit-test surface in `MarkdownTextarea/utils.ts` — cursor
   positions, mixed lists, indent edge cases.

Invocation: **main thread, sequential after PR 1 (parallel-safe with PR 2
but keep the stack linear), Fable 5, medium effort** — text-editing edge
cases are subtle; tests are the deliverable as much as the code.

### PR 4 — @mention autocomplete (~400–550 LOC)

`[BRIEF-56] feat: Mention Autocomplete Seeded From Participants`

1. Trigger on `@` in MarkdownTextarea; candidate source injected by the
   consumer (decision 7 — participants + PR author from the conversation
   payload; source interface ready for the collaborators ticket).
2. A11y combobox pattern (listbox popup, `aria-activedescendant`, keyboard
   nav, Escape closes without eating the composer's Escape).
3. Filtering, insertion with trailing space, no popup inside code fences.

Invocation: **main thread, sequential after PR 3, Fable 5, high effort** —
interaction design + a11y combobox is the second design-heavy part.

### PR 5 — Quote-reply, navigation guard, delete confirmation (~300–450 LOC)

`[BRIEF-56] feat: Quote Reply And Composer Safety Nets`

1. Quote-reply on thread comments: menu/button + R with text selected →
   `>`-quoted prefill into the reply composer (focus + cursor at end).
2. Navigation guard (router blocker) when any composer holds never-saved
   text.
3. Delete-draft confirmation — undo toast preferred (fits the zustand store
   model); confirmation dialog fallback if the toast surface fights the
   existing live-region pattern.

Invocation: **main thread, sequential after PR 4, Opus 5, medium effort** —
contained features on settled foundations.

## Revisit triggers

- Custom formatting logic balloons → `@github/markdown-toolbar-element`
  (decision 2 tripwire).
- Real friction on posted-comment edits → revisit read-only posture
  (decision 4).
- Mentions feel thin in real use → collaborators ticket already filed.
- Light theme work starts → tokenized composer hexes (PR 2) are the
  prerequisite surface.

## Out of scope (recorded)

- Resolve/unresolve threads — spawned ticket (Next).
- Collaborators mention source — spawned ticket (Next, V1).
- Image/file upload, suggestion apply-commit, PR-level + file-level
  comments, emoji autocomplete, `#` references, saved replies, reactions,
  slash commands, GitHub-side pending-review surfacing, syntax highlighting
  in rendered markdown.
