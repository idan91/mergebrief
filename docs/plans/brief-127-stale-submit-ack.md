# BRIEF-127 — Gate comment submission on stale brief views

Grill locked 2026-08-03 (wayfinder collapsed to single grill — no map).
Ticket: BRIEF-127 (Notion). Effort S, one PR.

## Locked decisions

1. **Acknowledge-and-proceed, never hard block.** Submission stays pinned to
   the reviewed `span.head` (BRIEF-23 commit_id discipline unchanged). The
   ticket's "anchor-to-current-head" variant is dead: anchors were read
   against the old diff; re-pinning would mis-anchor.
2. **Trigger** = `span.head !== meta.headSha` (`!currentHead`), both flavors:
   historical revision from the timeline, or newest brief with the PR head
   advanced past it. No special-casing by how the view became stale.
3. **Scope: batch Submit review only.** Post-now keeps its existing
   hidden-affordance gate (BRIEF-43, deliberate). Conversation replies and
   resolve-thread stay ungated — thread-level, no line anchor.
4. **Mechanics:** warning block + "submit against the reviewed revision
   anyway" checkbox in ReceiptDrawer. Submit `aria-disabled` until checked.
   Rendered only when stale; staleness evaluated live at render (a poll tick
   can flip it while the drawer is open — behavior follows visible state);
   not sticky across drawer opens.
5. **No server change, no new polling.** GitHub accepts advanced-head
   reviews (marks them outdated); force-push rewrite already 409s
   (UNKNOWN_COMMIT). Signal freshness inherits the banner's: 15s staleTime +
   focus refetch, no polling for ordinary reviewers — accepted.
6. **No follow-up tickets; HeadAdvancedBanner copy unchanged** (consent copy
   lives only where the consequence is — the receipt).

## Current-state facts (verified)

- `headAdvanced(meta, pinnedSpan)` — `briefRouteState.ts:163`; banner wired
  in `routes/repos.$repoId.pulls.$prNumber.tsx` (~line 430).
- `currentHead = meta.headSha === span.head` — `usePrBriefPlans.ts:89`.
- Submit flow: BriefScreen `useReviewSubmit` facade; `blockedExternally`
  seam exists (hard block + reason). The ack is NOT that seam — it is a
  drawer-local consent, not a screen-owned block.
- ReceiptDrawer already uses focusable-disabled (`aria-disabled`) submit.
- Server: review-submit 409s only on UNKNOWN_COMMIT; inline-comment 409s on
  GitHub 422 stale-anchor. Both already mapped to `stale` result kinds.

## Implementation (one part, one PR)

Branch `feature/BRIEF-127/stale-submit-ack` → PR
`[BRIEF-127] feat: Stale-Head Submit Acknowledge Gate`, base `main`.
Estimate ~250–350 changed LOC (prod + tests) — single PR, under ceiling.

Steps (TDD: drawer/gating tests first):

1. **Prop plumbing.** Route computes staleness (`!currentHead` — reuse the
   `headAdvanced` predicate against the explicit span) and passes a new
   optional BriefScreen prop (e.g. `staleHead?: boolean`); BriefScreen
   forwards to ReceiptDrawer. Local demo path never sets it (no PR meta —
   gate silently absent). Exported prop interfaces per apps/web conventions.
2. **ReceiptDrawer ack.** When `staleHead`: warning block (semantic tokens,
   rem units, `data-state` styling) + checkbox; submit `aria-disabled` until
   checked, reason copy on the disabled control consistent with existing
   blocked-reason rendering. Checkbox state local to the drawer, reset when
   the drawer opens (not sticky). When staleness flips false while open, the
   ack UI unrenders and submit gating returns to baseline.
3. **Copy.** Warning: "This pull request has newer commits. Comments will
   anchor to the revision you reviewed and may appear as outdated on
   GitHub." Checkbox label: "Submit against the reviewed revision anyway".
   Final wording at implementation; keep out of HeadAdvancedBanner.
4. **Tests.** ReceiptDrawer: stale renders warning + checkbox, submit
   disabled until checked, unchecked-reset on reopen, non-stale renders
   nothing new; jsdom pragma + `afterEach(cleanup)` (no auto-cleanup in this
   repo). Route/plan level: staleness prop derivation both flavors.

## Mandates

- **git-eng** for ALL git operations. Chunked commits (logical units);
  pre-commit gate: `security-reviewer` + `performance-reviewer` in parallel
  on staged diff before every commit, findings ≥80 confidence fixed before
  committing. No Co-Authored-By trailers, no AI attribution in PR body.
- **typescript-eng** and **tdd** skills mandatory during implementation.
- Verification: `pnpm -C apps/web typecheck && pnpm -C apps/web test &&
  pnpm -C apps/web lint` (build not needed — no isomorphic/server-only
  change).

## Execution recommendation

Single part, main session (current model, current effort). S-ticket FE
change — subagent delegation overhead exceeds benefit; the subtle piece
(live staleness while drawer open) is design-settled above.
