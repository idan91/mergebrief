# Single Brief View — Author Surface as State-Derived Affordances

The author/reviewer **view toggle is killed**. There is one Brief view for
every viewer. The author-side experience (ADR 0009) is realized as
**affordances derived from visible state** — `viewer == PR author && PR is
draft` — inside that single view, never as a mode, a toggle, or a separate
view. The stack below the FE stays **role-neutral**: no role concept enters
the API or persistence; the only server-side addition the author surface
ever needs is one GitHub *operation* (`markPullRequestReadyForReview`),
authorized by GitHub itself via the viewer's own token.

## Context

The app shipped a "Reviewer review / Author self-review" radio inside
`DemoControls`, rendered on every brief including DB-backed ones. As
shipped, author mode was six copy swaps plus one behavior gate: flipping
the radio silently disabled the live GitHub submit (`liveSubmit` required
reviewer mode) and replaced it with a mock toast. Zero author-specific
content existed — no intent check, no real ready-for-review action. Demo
scaffolding had leaked into a live product path and was gating real
behavior on a self-declared label (BRIEF-30: "doesn't make any sense").

This is the standing invisible-mode-gates rule applied at design level:
behavior must follow visible state, not a self-selected mode. A viewer
could flip to "author" on someone else's PR and get a fake "Mark ready"
button; a real reviewer could flip it and lose the real submit.

Meanwhile the entire stack below the web FE is deliberately role-neutral —
the API has no role concept, the CLI resolved role-neutral (ADRs
0028/0029), ADR 0009 is same-artifact — and BRIEF-25 had already
established the working pattern for viewer-specific behavior:
**identity-derived affordances** (own-comment reconciliation, the "yours"
tag) inside the single view, keyed on who the viewer verifiably is, not on
a mode.

## Decision tree walked (BRIEF-30 grill, 2026-07-13)

1. **The author-exclusive job is pre-ready self-review + the handoff.**
   Reading the own Brief during the draft window, confronting risk flags,
   then marking the PR ready for review. Responding-to-review stays
   identity-driven affordances in the shared view (BRIEF-25 pattern; full
   post-review flow deferred to v2 per ADR 0009). Intent narration stays
   dead (ADR 0009 — intent is machine-assessed from ticket/description,
   never authored).
2. **That job needs affordances, not a view.** The artifact is the same
   Brief byte-for-byte (ADR 0009 #1); the intent check is a shared section
   both consumers see; the soft gate and mark-ready are a button + modal.
   Nothing requires restructuring the page or a second view.
3. **Single view wins → the toggle dies.** Author affordances key on
   visible, verifiable state — the viewer is the PR author (authz already
   knows the viewer) and the PR is a GitHub draft (already in PR data).
   Both derived at read time; nothing stored.

## Decision

1. **One Brief view.** `ReviewMode`, the `DemoControls` perspective radio,
   all author-mode copy swaps, the `liveSubmit` author gate, and
   `?mode=author` on the summary-preview route are deleted. No replacement
   behavior — the app becomes single-view, reviewer-flow only, which is
   what it functionally was.
2. **The author surface's locked contract** (built later, in the
   author-side arc — see Consequences):
   - **Trigger state:** `viewer login == PR author login && PR is draft`.
     The state is **visibly labeled** in the UI (a self-review banner /
     framing) so behavioral differences read as state, never as bugs.
   - **Receipt and submit-review machinery hidden** in that state. The
     receipt is the terminal artifact of submitting a review; in own-draft
     state the terminal action is mark-ready. No submit → no receipt
     ceremony. (The old author-mode receipt reskin — "Self-review summary"
     — fabricated an author receipt ADR 0009 explicitly rules out.)
   - **Risk flags are a read-only mirror** in own-draft state — no
     author dispositions. The author's disposition mechanism is code: fix,
     push, the brief regenerates, the flag drops. Author-only dispositions
     that survive reload would be role-scoped server state — the exact
     persistence role concept this ADR exists to keep out (and ADR 0009
     forbids: "no persistent author state").
   - **Primary CTA = "Mark ready for review"**, pre-gated by the **soft
     gate** (ADR 0009 #3): a transient, non-blocking modal listing open
     risk flags — the existing pre-submit modal's shape, reused. Fix or
     authorize past it.
   - **Mark-ready executes via the platform**: one GitHub mutation
     (`markPullRequestReadyForReview`) with the viewer's own token. GitHub
     enforces that only the author (or a maintainer) can do it — no
     MergeBrief role model, no new authz semantics.
   - **Post-ready, the affordances vanish.** The author sees exactly what
     any reviewer sees — same view, same machinery. Chunk read-tracking
     and all reviewer tooling stay available in every state (local session
     state, role-free).
3. **Role-neutrality below the FE is reaffirmed as an invariant.** The
   author surface introduces no role concept into the API, persistence, or
   CLI — "author-ness" is derived per request from data both sides already
   have.

## Considered Options

- **Commit: a distinct author view (+ role concept).** Rejected — no
  author job requires hiding or restructuring anything a view could;
  the one distinct element is a CTA + modal. The grill's key finding:
  even ADR 0009's committed author design never needed a server role —
  the ticket's feared structural cost was avoidable on *both* branches,
  which removes the last argument for a view ("we already paid for it").
- **Toggle demoted to a demo/preview knob.** Rejected — the shipped
  toggle already *is* that, and it is the thing that didn't make sense:
  demo scaffolding gating live behavior. Demos use a demo brief.
- **Author-entry deep-links.** Moot — state is derived, no entry path
  needs to carry role.
- **Author surface in the CLI instead of the web.** Complementary, not a
  replacement: the role-neutral CLI (ADR 0028) covers *pre-push*
  self-review; the own-draft web state covers *pre-ready*. Different
  moments of the same arc.
- **Author dispositions (accept/dismiss own flags).** Rejected for v1 —
  session-local dies on reload (reads as a bug); persistent-author-only
  drags the role concept into persistence. Recorded as a revisit trigger
  in shared-state form (below).

## Why This Way

The BRIEF-25 precedent proved the pattern: viewer-specific behavior keyed
on verifiable identity/state works, ships incrementally, and never
confuses — while the one shipped mode toggle produced a fake button and a
silently-killed real one. Deriving author-ness keeps the role-neutral
stack intact (one authz model, one artifact, one view to maintain) and
makes the author surface an FE + one-mutation feature instead of a
schema-touching persona system. Hiding receipt/submit in own-draft state
is legitimate *state*-driven variation — the state is real (GitHub draft),
visible, and labeled — unlike the toggle, which was a self-declared label
gating real behavior.

## Revisit triggers

- **Author annotations for reviewers** — authors asking to leave notes on
  their own draft pre-ready ("known issue, context here"). Real workflow,
  v2-shaped (adjacent to ADR 0009's deferred post-review flow). Own grill.
- **Author dismissal visible to reviewers** — "known, won't fix, here's
  why" as *shared* state the reviewer inherits (not author-local). Real
  feature; own grill before any build.
- **Author arc scheduled** — when draft-first activation (ADR 0020 /
  center-of-gravity) gets build priority, the author-affordances ticket
  builds to this contract; the contract is not re-litigated, but new
  evidence from actual draft-first usage may amend it.
- **Self-review state wanting persistence** — if cross-session self-review
  progress (beyond local session state) is ever demanded, the
  role-in-persistence question reopens deliberately, here.

## Consequences

- **Amends ADR 0009**: Decision and analysis stand (same artifact, intent
  check, soft gate, no author state); its "FE gains an author self-review
  surface" is now realized as state-derived affordances inside the single
  Brief view per this ADR — never a separate view or mode.
- **Kill ticket (now, FE-only):** delete `ReviewMode`, the `DemoControls`
  radio, the copy swaps, the `liveSubmit` author gate, `?mode=author`.
  Pure deletion.
- **Author-affordances ticket (parked, author-side arc):** own-draft
  detection + visible labeling, soft gate reusing the pre-submit modal,
  the mark-ready mutation, receipt/submit hidden in-state. Unscheduled;
  travels with draft-first activation.
- The invisible-mode-gates rule graduates from FE feedback to a design
  invariant with an ADR to cite.
