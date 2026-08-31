# BRIEF-137 — Rework the review submission flow: one modal, verdict-first

Status: PLANNED (grill locked 2026-08-04; flow validated via throwaway HTML prototype)
Ticket: https://app.notion.com/p/3b25e9400eeb8172b08cc69b67507454

## Locked decisions (grill, 2026-08-04)

1. **Advisory gate folds into the modal** as a conditional first view — shown only
   when `unresolvedItems.length > 0`, re-shown on every open while items remain,
   no back-navigation to it; `jumpToItem` closes the whole modal and jumps.
2. **Submit + stale-head ack live on the verdict view; receipt is a pure preview
   view.** BRIEF-127's ack mechanics are unchanged (rendered only when stale,
   live-evaluated, not sticky across opens, Submit `aria-disabled` until checked)
   but relocate to the commit affordance. Amend
   `docs/plans/brief-127-stale-submit-ack.md` decision #6/#8 + the ADR 0019 #6
   note in the same PR that moves them.
3. **Verdict view is the default**; verdict ⇄ receipt are the only free
   navigation pair.
4. **Verdict picker is stripped from SummaryPreview** (becomes a read-only
   document; `setOutcome` prop dropped). SummaryPreviewDrawer + the standalone
   route survive; the modal carries no "Preview public summary" navigation —
   receipt view gets one plain sentence ("the signature line links a public
   summary"). Drawer flagged for possible later removal if it proves redundant.
5. **Escape closes the modal from any view** (never "step back"); close is
   non-destructive — outcome + review-comment draft live in the flow store and
   survive close/reopen; view position resets per open. No mid-submit close
   lock (BRIEF-23 machinery already covers it).
6. **New free-text review comment** (optional) on the verdict view. Wire body =
   `userComment + "\n\n---\n\n" + signatureLine` when the comment is nonempty,
   else the signature alone (today's behavior). Counted in the fold budget;
   oversize surfaces a new recoverable `submitBlockedReason` message. Reuse
   `MarkdownTextarea`. No ADR 0002 amendment needed — the tool's claims stay
   mechanical; the reviewer's words ride above the signature.
7. **State ownership:** BriefScreen's `receiptOpen`/`preSubmitOpen` collapse to
   one `submitOpen` (summary-preview drawer keeps its own flag). View position
   is modal-local `useState`. Flow store gains a `reviewComment` draft.
   `useReviewSubmit` gains a stable `getReviewComment` getter (never a raw
   string through the screen — its store-subscription discipline is
   booleans/transitions only), a `consumeReviewComment(sent)` callback, and
   exposes `blockedReasonWith(comment)` for the editor surface;
   `closeReceipt` renames to `closeSubmit`; the BRIEF-23 lifecycle is
   untouched. (Refined during PR 1 from the original "body input" wording —
   a screen-computed body would subscribe per keystroke or go stale.) New `SubmitModal`
   component (`features/review/components/SubmitModal/`) built on shared
   `Modal`; `PreSubmitModal` + `ReceiptDrawer` are deleted.

## Invariants that ride along (verify per PR)

- **ADR 0002:** receipt content, "not an approval" tag, `not checked:` line all
  unchanged — relocated only. Never the word "approval" in tool copy.
- **BRIEF-23 (apps/web/AGENTS.md async-mutation section):** capture-at-initiation,
  external write = commit point, indeterminate copy on throw, page toast
  (`announce`) outlives the modal, verdict spent on success, `submitBlockedReason`
  mirrors the API route's deterministic rejections.
- **BRIEF-127:** ack scope stays batch-Submit only; `base-drift` stays hard
  read-only; submission stays pinned to reviewed `span.head`; no server change.
- **Own-draft exclusion (BRIEF-43/ADR 0031):** SubmitModal unmounted when
  `ownDraftActive`; Header CTA remains "Mark ready for review".
- Shortcut standdown + `reviewerOverlayOpen` + `closeReviewerOverlays` swap the
  three old flags for `submitOpen`.

## Mandatory skills & process

- **git-eng for ALL git operations** (branching, commits, push, PRs). Stacked
  PRs off `main`, squash-merge realign per memory (`git-push-workflow`). No
  Co-Authored-By trailers, no AI attribution in PR bodies. Idan merges.
- Specialist skills, mandatory during implementation: **typescript-eng**,
  **web-accessibility**, **frontend-design**.
- Commit strategy (confirmed): **chunked logical commits**, with
  **performance-reviewer on staged changes before each commit**; findings
  confidence ≥ 80 get fixed and re-run until clean.
- Review loop per PR (confirmed): **reviewer on the branch diff** +
  performance-reviewer gate above; **medium+ findings iterate**, nitpick-only =
  clean (memory: feedback-review-loop-severity).
- **/impeccable audit on the RENDERED modal as a merge gate** (PR 3, once the
  full flow exists): default verdict view + receipt view + back navigation,
  wide + narrow viewports, own-draft excluded (no submit surface there).
  Findings triaged medium+.
- Gates per PR, apps/web only: `typecheck`, `test`, `lint`, `build`, `e2e` —
  all required. Coverage floors ride inside `pnpm test` (ADR 0038 §3).
- No generation-surface files touched ⇒ eval harness not required.

## PR stack (confirmed: 3 PRs)

Branches `feature/BRIEF-137/<slug>`, each PR based on the previous.

### PR 1 — plumbing: review-comment body + store draft + read-only SummaryPreview (~350 LOC)

No visual shell change. Sequential, main thread. Model: this session (Fable 5),
effort medium — mechanical + contract care.

1. `submit.ts`: body composition helper — `userComment\n\n---\n\nsignature`
   (nonempty case), signature alone otherwise; fold-budget math counts the
   comment + separator; new recoverable `submitBlockedReason` message for
   oversize review comment. Unit tests incl. budget edges.
2. Flow store: `reviewComment` draft + `setReviewComment` action (persists
   across modal close; cleared on successful submit alongside verdict-spent).
3. `useReviewSubmit`: `getReviewComment` getter + `consumeReviewComment` +
   `blockedReasonWith` (see decision 7); body composed in the hook at click
   time; rename `closeReceipt` → `closeSubmit`. Lifecycle untouched. Tests
   updated.
4. SummaryPreview: drop `setOutcome` prop + picker → read-only document;
   callers (SummaryPreviewDrawer, standalone route) updated; tests updated.

### PR 2 — SubmitModal: verdict + receipt views, replaces ReceiptDrawer (~500 LOC)

Design-heavy: a11y + visual. Sequential after PR 1, main thread. Model: this
session (Fable 5), effort high. web-accessibility + frontend-design active.

1. `SubmitModal/` on shared `Modal` (one trap, one Escape, one labelledby):
   - **verdict view (default):** outcome picker (relocated styles/labels from
     SummaryPreview), `MarkdownTextarea` review comment, stale warning +
     ack checkbox (relocated from ReceiptDrawer, same mechanics + live region
     wrapping text only), `submitBlockedReason`/error/pending/note surfaces
     (same roles: alert, status), Submit button (focusable-disabled pattern,
     in-handler guard), "Preview receipt" nav.
   - **receipt view:** receipt `<pre>` body, "not an approval" tag, sub-line +
     "signature links a public summary" sentence, "Back to verdict".
2. BriefScreen: `receiptOpen` → `submitOpen`; ReceiptDrawer wiring moves to
   SubmitModal; Header Submit CTA opens SubmitModal (verdict view; advisory
   arrives in PR 3 — until then PreSubmitModal still fronts it, temporary
   `continueToReceipt` → opens SubmitModal).
3. Delete `ReceiptDrawer/` (+ tests → ported to SubmitModal tests).
4. e2e: submit-path specs updated.

### PR 3 — advisory view + delete PreSubmitModal + doc amendments (~250 LOC)

Sequential after PR 2, main thread. Model: this session (Fable 5), effort
medium.

1. SubmitModal gains `advisory` view: open lands there iff unresolved items
   exist; items list captured at open; Continue → verdict; `jumpToItem` closes
   modal + jumps; kind labels ported.
2. BriefScreen: `preSubmitOpen` deleted; Header CTA target = SubmitModal
   directly; shortcut standdown / `reviewerOverlayOpen` / `closeReviewerOverlays`
   finalized on `submitOpen`.
3. Delete `PreSubmitModal/` (+ tests ported).
4. Amend `docs/plans/brief-127-stale-submit-ack.md` (#6/#8 location) + ADR 0019
   #6 note.
5. e2e: advisory-path specs; **/impeccable merge-gate audit** on the rendered
   modal (all three views, wide + narrow), triage medium+, fix before merge.

## Prototype

`$CLAUDE_JOB_DIR/tmp/brief-137-submit-modal-prototype.html` — throwaway,
validated the flow 2026-08-04 (Idan). Delete after implementation starts;
this plan captures the answer.
