# BRIEF-127 — Stale brief views: convert the hard write-block to acknowledge-and-proceed

Grill locked 2026-08-03 (wayfinder collapsed to a single grill — no map).
RESCOPED same day: implementation discovery showed the ticket's premise
("commenting stays enabled on stale views") is false on the modern timeline
path — ADR 0019 #6 (BRIEF-24) already HARD-BLOCKS it. Idan chose to convert
that hard block to the ack model (option 2 of the rescope).

## Locked decisions

1. **Acknowledge-and-proceed replaces the hard block** for the two
   head-mismatch flavors: `historical` (earlier revision selected) and
   `head-advanced` (latest brief, PR head moved past it). Composer re-enables
   on those views; batch Submit review requires an explicit ack.
2. **`base-drift` stays hard read-only** (same head, superseded base):
   the rendered diff's base is not the PR's base, so line anchors can land
   wrong or nowhere on GitHub — write-safety, not cosmetics.
3. **Submission stays pinned to the reviewed `span.head`** (BRIEF-23
   discipline). The "anchor-to-current-head" ticket variant is dead.
4. **Legacy non-timeline path gets the same ack** (the ticket's original
   target): staleness = `meta.headSha !== span.head`, unified across paths.
5. **Scope: batch Submit review only.** Post-now keeps its hidden-affordance
   gate (BRIEF-43, deliberate). Replies + resolve-thread stay ungated
   (thread-level, no line anchor).
6. **Ack mechanics:** warning block + "submit against the reviewed revision
   anyway" checkbox in ReceiptDrawer. Submit `aria-disabled` until checked.
   Rendered only when stale; evaluated live (poll tick can flip it while the
   drawer is open — behavior follows visible state); not sticky across
   drawer opens.
7. **No server change, no new polling.** GitHub accepts advanced-head
   reviews (marks them outdated); force-push rewrite already 409s
   (UNKNOWN_COMMIT); GitHub 422 stale-anchor already maps to a 409/`stale`
   toast — that remains the backstop when an acked submit's anchors truly
   died. Signal freshness inherits the meta query's (15s staleTime + focus
   refetch).
8. **Consent copy lives at the receipt only** — HeadAdvancedBanner and the
   timeline navigator keep their navigation-offer roles. ADR 0019 #6 gets
   amended in the same PR (decision + behavior atomic).

## Current-state facts (verified)

- Route `repos.$repoId.pulls.$prNumber.tsx:291-330`: three-way
  `readOnlyKind` (`historical` / `head-advanced` / `base-drift`), all hard —
  drives composer disable, submit block, navigator "read-only" chip,
  WarmingChip suppression, announcements.
- `readOnly` consumers: BriefScreen `composerDisabledReason` (×2), mount
  announce, ReceiptDrawer submit wiring; PrBriefContent WarmingChip gate +
  DbBriefControls chip; PrBriefBody `timelineAnnouncement` writable flag.
- Characterization: `features/pulls/prTimelineRoute.test.tsx` pins the hard
  block for all three kinds (historical, head-advanced, base-drift).
- ReceiptDrawer: focusable-disabled submit (`aria-disabled` +
  `aria-describedby` reason text) — the ack composes onto this pattern.
- Server: review-submit 409s only on UNKNOWN_COMMIT; inline-comment 409s on
  GitHub 422 stale-anchor; FE transports map both to `stale` kinds.

## Implementation (one code PR)

Branch `feature/BRIEF-127/stale-submit-ack` → PR
`[BRIEF-127] feat: Stale-View Submit Acknowledge Replaces Hard Block`,
base `main`. Estimate ~450–550 changed LOC incl. tests + ADR amendment —
single PR, under ceiling.

Steps (TDD; the existing route characterization tests are the red anchors):

1. **Route posture split.** `readOnlyKind` narrows to `base-drift` only.
   New `staleHead` boolean derived from the resolved span:
   `meta.headSha !== null && meta.headSha !== span.head` — covers timeline
   historical/head-advanced AND the legacy explicit-span path. Dead
   READ_ONLY_REASONS copy removed. Prop plumbed
   route → PrBriefBody → PrBriefContent → BriefView → BriefScreen
   (exported prop interfaces).
2. **Visible-state consequences.** WarmingChip suppression keys off
   `staleHead || readOnly` (unchanged visible behavior). DbBriefControls
   "read-only" chip renders only for base-drift now. Timeline announcement
   drops "Read-only." for stale-writable revisions (falls out of
   `writable = readOnly === undefined`). No new stale announcement — the
   receipt owns consent.
3. **ReceiptDrawer ack.** New `staleHead?: boolean` prop. When set: warning
   block ("This pull request has newer commits. Comments will anchor to the
   revision you reviewed and may appear as outdated on GitHub.") + checkbox
   ("Submit against the reviewed revision anyway"); submit `aria-disabled`
   until checked, `aria-describedby` → warning id when unacked (existing
   blocked-reason takes precedence). Checkbox state drawer-local, reset on
   open transition (state-during-render adjustment pattern, no effect).
   Styles: semantic tokens, rem via `functions.to-rem`, `data-state`
   attributes.
4. **Tests.** prTimelineRoute.test: historical + head-advanced flip to
   writable-with-ack (composer enabled, submit gated at receipt);
   base-drift pinned unchanged. ReceiptDrawer tests: stale renders warning +
   checkbox, submit disabled until checked, reset on reopen, non-stale
   unchanged, live flip while open clears the ack UI. jsdom pragma +
   `afterEach(cleanup)` (no auto-cleanup in this repo).
5. **ADR 0019 #6 amendment** in the same PR: historical/head-advanced
   become writable-with-ack; base-drift stays read-only; rationale =
   reviewer work is span-pinned and GitHub natively supports older-commit
   reviews (outdated tags), so the block cost (stranded drafts) exceeds the
   footgun it prevented.

## Mandates

- **git-eng** for ALL git operations. Chunked commits (logical units);
  pre-commit gate: `security-reviewer` + `performance-reviewer` in parallel
  on staged diff before every commit, findings ≥80 confidence fixed before
  committing. No Co-Authored-By trailers, no AI attribution in PR body.
- **typescript-eng** and **tdd** skills mandatory during implementation.
- Verification: `pnpm -C apps/web typecheck && pnpm -C apps/web test &&
  pnpm -C apps/web lint` (no isomorphic/server-only change → build not
  required).

## Execution recommendation

Single part, main session (current model, current effort). The subtle
pieces (posture split fan-out, live staleness while the drawer is open) are
design-settled above; remaining work is disciplined execution.
