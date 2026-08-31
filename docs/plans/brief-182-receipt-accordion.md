# BRIEF-182 — Collapse the summary-preview surfaces

Decisions locked on the ticket (grill + prototype, 2026-08-15): the
`SummaryPreviewDrawer` dies and `components/Drawer/*` goes with it; the
standalone `/briefs/$briefId/summary-preview` route survives as the
demo/local testing view; the submit modal's receipt view replaces its `<pre>`
with the accordion rendering (prototype variant D) plus a collapsed
"show raw" disclosure. The frozen GitHub artifact format is untouched on the
wire.

Prototype (primary source): branch `prototype/brief-182-receipt-variants`
@ 50977f4c — four variants inside the real SubmitModal, `?variant=`-switched.

## Git workflow (mandatory: `git-eng` skill for all git operations)

- 2-PR stack: `feature/BRIEF-182-receipt-accordion` off main; PR2 branch
  `feature/BRIEF-182-drawer-removal` stacked on PR1. After PR1 squash-merges,
  realign PR2 with `rebase --onto` (patch-id proof), never a plain pull.
- Chunked commits: commit after each logical unit.
- Pre-commit gate: `performance-reviewer` on staged changes before every
  commit; findings ≥80 confidence get fixed before committing.
- Pre-PR gate: `reviewer` adversarial pass on each branch diff before
  the PR goes up; medium+ findings iterate (max 2 rounds).
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- PR titles: `[BRIEF-182] feat: …` / `[BRIEF-182] refactor: …`.
- Screenshots for PR bodies via SendUserFile (raw URLs don't render in this
  private repo; Idan drag-drops).

## Specialist skills (mandatory during implementation)

- `typescript-eng` — repo TS standards.
- `web-accessibility` — accordion semantics inside a dialog, focus flow,
  the deletion of the dialog-less Drawer.
- `impeccable` — rendered-UI audit of the accordion view (PR1) before it
  ships; render-proof screenshots + measurement before any CSS lands.

## PR1 — `[BRIEF-182] feat: accordion receipt view in SubmitModal` (~450 LOC)

Model/effort: Fable 5, medium — main session.
Invocation: main thread.

1. New co-located component `SubmitModal/ReceiptAccordion/` (sub-components,
   utils, consts in dedicated co-located files at birth):
   - Pinned outcome card: outcome value + `summarySignatureLine`.
   - Coverage section, **open by default**: chunks reviewed, risk flags,
     inline comments counts. Decision: the core/supporting chunk split is
     **dropped** in the modal — `Receipt` stays untouched; the advisory view
     already surfaces unreviewed-core items, and the standalone
     `SummaryPreview` keeps the full split.
   - Folds with counts in their summaries: Inline comments (n), Risk
     disposition (a addressed · d dismissed · o open), Not checked, and
     "Show raw receipt (as posted to GitHub)" wrapping the existing
     `receiptText(receipt)` `<pre>` — the frozen English artifact, unchanged.
2. `SubmitModal` receipt branch renders the accordion; `receiptText` /
   `rawReceiptText` stay where they are.
3. i18n: all new labels/fold summaries through `packages/i18n` catalog keys
   (counts via interpolation). The raw `<pre>` content stays English/frozen.
4. A11y: native `<details>/<summary>`; focus-visible ring on summaries;
   heading-focus-on-view-switch behavior unchanged; axe pass on the open
   receipt view.
5. Tests (jsdom pragma + `afterEach(cleanup)`): folds render with counts,
   coverage open by default, raw disclosure contains the frozen text,
   view-switch focus still lands on the heading.
6. Render-proof: dev server + playwright screenshot + measure; then
   `impeccable` audit on the rendered view. Gotchas from the prototype:
   dev server lands on port 3005; local brief
   `Idan91-code-review-13_2_440130d8` needs no auth seeding; click Submit
   only after networkidle + settle or the pre-hydration click no-ops.
7. Gates: `pnpm -C apps/web typecheck && test && lint && build`.

## PR2 — `[BRIEF-182] refactor: delete summary-preview drawer + Drawer` (~400 LOC, mostly deletions)

Model/effort: Fable 5, medium — main session.
Invocation: main thread, after PR1 is up (stacked).

1. Delete `BriefScreen/SummaryPreviewDrawer/` and `components/Drawer/*`
   (sole consumer — the a11y hole goes with it).
2. `BriefScreen`: drop `summaryPreviewOpen` state + open/close handlers;
   `reviewerOverlayOpen` and `shortcutsDisabled` lose the term; drawer
   render and `openSummaryPreviewDrawer` prop pass go.
3. `Header`: drop the `openSummaryPreviewDrawer` prop and the DB-path menu
   branch. The summary-preview `<Link>` stays **local-path only** — gate it
   on the brief's local identity directly (the current proxy is
   `openSummaryPreviewDrawer === undefined`; replace with the real
   local-vs-`db:` signal available at the call site). DB briefs get no menu
   entry — the submit flow is their receipt surface.
4. `SummaryPreview`: the drawer was the only non-standalone consumer — drop
   the `standalone` prop, always render as the standalone page
   (`#main-content` id stays unconditional).
5. Tests: update `briefScreen.test.tsx` (href assertion survives), Header
   menu tests, delete Drawer tests.
6. Ride-alongs: stale `?mode=author` URL in
   `docs/impl/scss-modules-migration-prompt.md:78`; drop freed i18n keys if
   any become orphaned (check `pnpm -C packages/i18n test` prune tooling).
7. Gates: full `pnpm -C apps/web typecheck && test && lint && build`; axe
   pass on BriefScreen to confirm no landmark regressions (duplicate `<main>`
   is gone by construction).

## Out of scope

- Any change to the wire/artifact receipt format.
- Focus-trap work on Drawer (deleted instead).
- Standalone route redesign — it survives as-is for local testing.

## Verification checklist (both PRs)

- `pnpm -C apps/web typecheck && pnpm -C apps/web test && pnpm -C apps/web lint && pnpm -C apps/web build`
- Screenshot the receipt view (and post-deletion brief screen) at 1440px;
  measure before/after; SendUserFile the shots for the PR bodies.
- No eval-harness run needed — generation surface untouched.
