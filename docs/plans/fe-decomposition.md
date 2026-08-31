# FE decomposition — BriefScreen, ConversationSection, PR route

Executes items 2–4 of the 2026-07-27 front-end audit. Item 1 (hooks bug
fixes) landed as PR #172. Items 5–6 (mechanical sweep, structure hygiene)
follow separately after this stack; sweep items ride along here ONLY in
files a PR already restructures.

## Locked decisions (grill, 2026-07-27)

1. **ReviewFlow store, zustand-in-context** (same pattern as
   `MindMapProvider` — NOT plain React context). Provided by BriefScreen;
   selector subscriptions preserve the ChunkCard/GroupCard memo boundaries.
2. **Boundary line — store actions mutate store state; everything else
   stays props.** Into the store: composer anchor + comment CRUD, post-now
   family (`postingCommentIds`, `postBlockedExternally`), risk
   dismiss/evidence targets + selection, read-only posture
   (`composerDisabledReason`, `flagsReadOnly`). Stays props: nav/session
   handlers (`jumpToChunk`, `toggleChunk`, `markReviewed`, `openChunks`,
   `activeChunkId`, `focusMode`, `collapseSupporting`, `startReadThrough`)
   and data (`brief`, `model`, `comparison`).
3. **Conversation wiring deferred to PR 3** — its shape changes in the
   split; moving it twice is churn.
4. **ThreadRowView promotes** to `conversation/components/ThreadRowView/`
   (sibling of ConversationSection) — cross-feature consumer (DiffTable)
   fired ADR 0037's promotion rule.
5. **DbBrief renames to PrBriefContent**, its assembly hook is
   `usePrBriefPlans` — role naming, not data-source naming.
6. **PrBriefStates dissolves** into sibling folders under `PrBrief/` —
   the states differ structurally; a variant component would reintroduce
   an internal switch. Separate small components, one folder each.

### Maintainability note (owner-requested, record here)

Actions-in-store was questioned in the grill: is it harder to track than
props? Resolution: it is zustand-idiomatic and repo precedent
(`MindMapActions` via `useMindMapActions`); `grep useReviewActions` finds
every caller and the action body sits next to the state it mutates.
**Watch item:** if ReviewFlow store actions start doing non-store work
(nav, scroll, focus), the boundary line is being crossed — move those back
to props/session ownership.

## Process requirements

- **git-eng is mandatory for all git operations.** Per PR: feature branch
  off fresh main, chunked commits (one logical unit each),
  performance-reviewer pre-commit gate on every staged chunk, push +
  ready PR via `gh`, Idan merges. Sequential merges — each PR lands on
  main before the next branch cuts (big refactors, not a stack).
- **Mandatory skills:** `typescript-eng` (store typing, as-const maps,
  interface moves), `web-accessibility` (APG menu, modals, live regions
  must survive moves intact), `vercel-react-best-practices` (memo
  boundaries are the crux of PR 1).
- **Per-PR gates:** reviewer inline loop (lean stage-gate — no
  finder fan-out; medium+ findings iterate, low/nitpick-only = clean with
  a note in the PR body); `pnpm -C apps/web typecheck && test && lint`
  (exit codes judge); `build` when server/isomorphic edges move (PR 4
  touches the route — build required there). Characterization suite green
  per PR. Diff-stat measured after every part; split triggers act, not
  advise.
- No eval-harness runs — nothing touches generation surfaces.

## PR spine

Sequential, each depends on the previous landing.

### PR 1 — ReviewFlow store + wiring migration

**Model: Fable 5, high effort, main thread** (store design + boundary
judgment). Estimated ~800–1000 LOC. **Split trigger:** if the store +
StoryView/ChunkCard/GroupCard migration alone approaches the ceiling,
the modals migration (`RiskFlagModals`, `EvidenceModal`, `CommentThread`)
splits out as PR 1b.

1. `features/review/session/` gains the ReviewFlow store (new sibling
   provider or a colocated `flow/` module — decide in-code, but it must
   NOT enter the persisted MindMap snapshot: serialization stays
   comment/disposition-only).
   - State: `composerAnchor`, `dismissTarget`, `evidenceTarget`,
     `selectedRiskFlags`, `postingCommentIds`, posture fields.
   - Actions (stable object, built once): `openComposer`,
     `cancelComposer`, `saveComment`, `updateComment`, `deleteComment`,
     `toggleComment`, `postComment?`, `setDismissTarget`,
     `setEvidenceTarget`, `toggleRiskFlag`, `toggleRiskGroup`.
   - Hooks: `useReviewFlow(selector)`, `useReviewActions()`.
   - Unit tests colocated (store.test pattern exists).
2. BriefScreen provides the store; its ~15 wiring useCallbacks move into
   provider setup; screen-local state for these families is deleted.
3. ChunkCard/GroupCard/modals consume via hooks; chunk-scoped selectors
   (anchor-match, selection-intersection) keep memo wins — composer open
   re-renders ONE card, flag selection ONE group.
4. StoryView interface shrinks 33 → ~12 props; ChunkCard 22 → ~10.
   Delete every pass-through.
5. Characterization matrix run against comparison/composer/risk flows.

### PR 2 — BriefScreen extraction

**Model: Opus 5, main thread, after PR 1 merges.** Estimated ~600–800 LOC
(mostly moves). Target: BriefScreen ≤ ~400 lines of composition.

1. Extract `SummarySection/` (two-column split + PR-description toggle,
   ~701–759), `FocusBanner/` (~667–690), `SummaryPreviewDrawer/`
   (private component at 1003–1033 → own folder). Co-located scss +
   `data-testid`/`data-state` at birth.
2. Conversation glue block (~306–464) → `useConversationWiring` facade
   hook alongside the other five.
3. Ride-along in touched files only: `conversationGroupIds` body →
   `BriefScreen/utils.ts`; origin-comment strip (Classes A–C) in
   BriefScreen.tsx + the extracted files; drop the ~13 dead useCallbacks
   whose consumers are non-memoized (audit list).

### PR 3 — ConversationSection split

**Model: Opus 5, main thread, after PR 2 merges.** Estimated ~800 LOC
(file moves dominate).

1. Split per locked shape: `ConversationSection/` keeps section +
   `?thread=` landing (~300 lines); `ReplyComposer/` and
   `DigestGroupView/` (with `BotGroupRowView` nested) under it;
   `ThreadRowView/` promotes to a sibling with `ThreadDetail/` +
   `RevisionJumpAction/` nested. Entry barrel re-exports unchanged for
   DiffTable.
2. Conversation wiring re-shaped: subcomponents read review actions from
   the ReviewFlow store where applicable instead of new prop chains
   (the item-2 deferral lands here).
3. Ride-alongs: `botGroupChip(row)` extracted next to `threadStateChip`;
   the raw PR-comment row JSX (~697–725) becomes a component; the
   duplicate inline set-toggle adopts `toggleSetMember`; ReplyComposer's
   switch → kind-keyed failure map; origin-comment strip (13 hits).
4. A11y invariants preserved verbatim: focus rescues, live-region
   choreography, locked chip-precedence copy.

### PR 4 — PR route slim-down

**Model: Opus 5, main thread, after PR 3 merges.** Estimated ~700 LOC.
`build` gate required (route file).

1. Create `features/pulls/components/PrBrief/` per locked shape:
   `PrBriefBody/`, `PrBriefContent/` (renamed from DbBrief),
   `WaitCard/` (with `LiveDiffPreview/` nested), `FailedCard/`,
   `EmptyCard/`, `SupersededCard/`, `HeadAdvancedBanner/`,
   `WarmingChip/`. PrBriefStates file + name disappear.
2. Extract `features/pulls/hooks/usePrBriefPlans.ts` — plan memos,
   transports, own-draft derivation, identity-pinning discipline —
   with unit tests (first coverage for this logic).
3. Route file keeps loader + `validateSearch` + `PrBriefRoute`
   composition (~300 lines). `PrBriefError` + announcement helpers move
   with their components.
4. Ride-alongs: route's `PrBriefError` ternary + readOnly-reason ternary
   → kind-keyed maps; header-comment PR-sequencing tags dropped in moved
   files; origin-comment strip (4 hits).

## Out of scope (later items of the audit plan)

- Standalone mechanical sweep PR: remaining switch→map conversions
  (`apiFetch.kindForStatus`, `useMarkReady` copy-map re-key,
  `markReadyBatchFailureCopy`, `PullsSection.statusLabel`,
  `SummaryPreview.reviewOutcomeLabel`, `useOwnDraftFlow` failure map),
  remaining util extractions (ReceiptDrawer `formatReceiptBody`,
  GroupCard derivations, `repoConfigChipState`, ChunkCard partition),
  remaining dead useCallbacks, remaining origin comments.
- Structure hygiene: flat hooks → `hooks/` (pulls/review/tokens),
  ADR 0037 §4 loose-file rule, Header three-way split,
  `ModalContent.module.scss` ghost component, `validation.ts` split,
  import-alias rule.
