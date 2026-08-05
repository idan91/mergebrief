# BRIEF-99 — Reviewer filter bar with state counts (decisions)

Grilled 2026-08-05. All decisions locked; implementation not started. Pick up with
`/init-plan` in a fresh session. Ticket: BRIEF-99 (Notion board).

## Goal (from ticket)

Answer at a glance: who has reviewed this PR and what did they say? Filter bar
above the conversation digest: verdict-state chips with counts, human/bot split,
per-reviewer chips with All/None, recency toggle.

## Decisions

1. **No wayfinder map.** Effort S, pure FE, data confirmed present — single grill
   session, this doc is the outcome.

2. **Filter scope — three populations, two surfaces.** Reviewer chips filter
   reviews, thread rows, *and* top-level PR comments. Verdict chips + recency
   toggle apply to reviews only (threads/comments have no verdict). Filtering
   applies in **both** the conversation digest and the inline in-diff threads
   (explicit override of the digest-only recommendation).

3. **Combination semantics.** Within a chip family = OR; across families = AND.
   Empty family = inactive (no filter), never "show nothing". All/None quick
   links act on the reviewer family; None = clear = inactive.

4. **Counts are faceted and toggle-aware.** Verdict counts recompute under the
   recency toggle (latest-per-reviewer reduction happens *before* counting) and
   under the reviewer selection — chips always describe what is currently
   visible under the other family's filter. Counts churn on click; accepted.

5. **Human/bot rendering.** One bar, two rows.
   - Row 1 — verdict chips: primary count = humans; bot count as muted secondary
     inside the same chip ("Approve 2 · 1 bot", styled like existing `botTag`).
     No separate bot verdict row.
   - Row 2 — reviewer chips: humans first, thin divider, then bot authors
     (bot-styled). All/None at row end.
   - Zero-count verdict states render no chip at all.

6. **DISMISSED dropped from the bar.** No DISMISSED chip (user: confusing).
   Dismissed reviews still render in the unfiltered strip; they match no chip,
   so any active verdict filter hides them.

7. **Recency toggle defaults ON** (most-recent-per-reviewer). The goal is "what
   stands now"; full history is one toggle away. Default strip contents change
   vs today — intended fix, not regression.
   - Ordering: `submittedAt` is optional on the wire — fallback = array order
     (GitHub returns submission order, fetched `first: 100`); reduction takes
     last-seen per author login.

8. **Filter state lives in the URL** (user override of store recommendation).
   Search params, `replace` on chip clicks (no history entry per click) —
   DbCompareBar pattern (`compareState.ts` helpers). Both BriefScreen routes
   (GitHub + DB paths) must wire the params.

9. **Hidden-threads indicator.** When filters hide inline diff threads, the
   filter bar shows a count pill ("N threads hidden") — nothing floats in the
   diff itself. Guards against silently misleading absence in the diff.

10. **Empty filter result.** Plain muted "No activity matches filters" + inline
    clear link. No illustration.

11. **Out of scope.** Thread-state chips (open/resolved/outdated filtering) —
    existing sort + chips already cover it. Backend changes — none expected or
    permitted; pure FE.

## Grounding facts (verified 2026-08-05)

- `ConversationReview { reviewId, author, state, body, submittedAt?, url }` —
  `apps/web/src/features/conversation/types.ts:78-85`; `author.isBot` first-class.
- Verdict vocabulary: `COMMENTED | APPROVED | CHANGES_REQUESTED | DISMISSED`
  (`types.ts:31-37`); PENDING dropped server-side.
- Digest structure: `ConversationSection.tsx` renders verdict strip (flat, one
  li per review) + chunk-grouped thread rows (`utils/digest.ts`); bot split
  exists for threads only. `InlineThreads` renders same view-model in the diff.
- Conversation UI state today = local `useState`; no store. URL precedent =
  `DbCompareBar` + `features/brief/comparison/compareState.ts`.
- Reusable chrome: `AttributeJumpRail` (chip rail + counts + sr-only context),
  `rows.module.scss` chip/`botTag`/`count` classes, `toggleSet` util.
- Tests nearby: `utils/digest.test.ts`, `types.test.ts`,
  `ConversationSection.test.tsx`.

## Implementation notes for pickup

- Filter predicate + latest-per-reviewer reduction + faceted counting belong in
  a pure util next to `digest.ts` (unit-testable, shared by digest + inline).
- Visual PR gets `/impeccable` audit (standing rule for visual PRs).
- A11y: chips are toggle buttons (`aria-pressed`), counts need sr-only context;
  follow AttributeJumpRail precedent.
