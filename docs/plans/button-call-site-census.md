# Button call-site census + disposition draft (BRIEF-187)

Research asset for the wayfinder map "One Button component with variants — retire `.btn`".
Every `<button>` in `apps/web/src` plus the two `<a className="btn primary">` anchors,
classified into candidate buckets for the sibling-set grill to react to. Line numbers
are as of main @ 2026-08-13; treat as anchors, not gospel.

**Totals: 109 `<button>` elements + 2 anchors = 111 sites.** (The ticket's "111 buttons"
grep counted two comment lines that mention `<button>`; the real button count is 109.)

## Buckets

- **MIGRATE** — standard action button; becomes a variant of the shared Button.
- **FAMILY** — belongs to a different shared family (icon-button, menu item, chip/pill,
  disclosure, row-as-button, toolbar button, stepper, tab, link-button); not a Button
  variant, but a consolidation candidate within its family.
- **BESPOKE** — genuinely distinct affordance (scrim, gutter overlay, mini-map tick…);
  keeps its local class.

| Bucket | Count |
|---|---|
| MIGRATE (buttons) | 48 |
| MIGRATE (anchors, need `as="a"`) | 2 |
| FAMILY | 44 |
| BESPOKE | 17 |

## The global `.btn` today

`apps/web/src/styles/base.scss:148-203`. Base = outline/secondary (1px `--line2` border,
transparent bg, 8/16 padding, radius-md, weight 600). Modifiers: `.primary` (filled
inverse), `.compact` (4/10 padding, radius-sm, font-size-md — sits beside chips).
`[aria-disabled="true"]` is styled deliberately: the comment says self-disabling controls
must never use the `disabled` attr because browsers blur the element the instant it
lands, so the convention is `aria-disabled` + no-op handler. No danger variant, no size
scale beyond `compact`. **`.btn` appears at only 26 sites** (24 buttons + 2 anchors);
the other 85 buttons carry component-local classes (75) or no class (10, styled by
descendant selectors).

## Findings that bear on the sibling-set decision

1. **`aria-disabled` is a first-class requirement, not an edge case.** Ten sites
   deliberately use `aria-disabled` (+ onClick guard) with explicit comments about focus
   loss: Header:255, MarkReadyModal:215, SubmitModal:270, ReplyComposer:330/347,
   ThreadResolveAction:47, RevisionJumpAction:50, ConversationFilterPanel:174/190/203,
   MarkdownTextarea:279, DbTimelineNavigator:80/122. Meanwhile eight sites use the real
   `disabled` attr for the same semantic role (GroupCard:407/426, EvidenceModal:141,
   CommentThread ×4, TokenSettings ×2, ConversationSection:371, OrgSwitcher:139,
   routes/index:99). The shared Button must model both — a single `disabled` prop that
   always renders the attribute regresses the focus-preservation sites.
2. **Live bug the shared Button would fix:** `rowStyles.action` only styles `&:disabled`,
   so its four `aria-disabled` users (ReplyComposer:330/347, ThreadResolveAction:47,
   RevisionJumpAction:50) look enabled while inert.
3. **The biggest duplication is not `.btn`:**
   - Toolbar box copy-pasted three times, byte-identical 15 declarations:
     `ReadingToolbar .tbtn`, `FilterDisclosure .trigger`, `RiskAttrsDisclosure .trigger`.
   - `InlineThreads .botButton` near-verbatim copies `rows.module.scss .rowButton`.
   - `OrgSwitcher` and `LocalePicker` triggers + menu items are the same rule sets at
     two font sizes.
4. **`rowStyles.action` is the de-facto small/quiet Button** — 11 buttons + 1 anchor
   (ThreadDetail:189) already share it. Polymorphic `as="a"` is required by 3 anchor
   sites total (2 sign-in `.btn primary` anchors + this one).
5. **A `link` variant has real demand:** MarkReadyModal's three inline jump buttons
   (150/166/186) wear full `.btn` chrome inside prose paragraphs; CommentThread's
   Edit/Collapse/Delete, DigestGroupView `.groupJump`, GroupCard `.fileButton`,
   SinceMarker `.deltaLink`, SummarySection toggle are all link-like buttons.
6. **Unclassed buttons are a migration trap:** 10 buttons styled purely by descendant
   selectors (`.threadActions button`, `.tabs button`, ConcernView row). Migrating one to
   a component that brings its own class double-styles it; leaving it renders unstyled if
   the parent selector is removed.
7. **`data-*` + `ref` passthrough are load-bearing:** `data-testid="thread-row"`,
   `data-post-cta`, `data-state`, `data-variant`, forwarded refs (ReplyComposer keeps
   focus across a re-render).
8. **A11y gaps found while reading:** CommentThread:98 and SummarySection:41 toggle
   collapse state with no `aria-expanded`.

---

## Full disposition list

Paths relative to `apps/web/src/`. Content: text / icon (icon-only; `AL` = has
accessible name) / mixed. Dis: `dis` = disabled attr, `a-dis` = aria-disabled, `-` = none.

### MIGRATE — shared Button (48 buttons + 2 anchors)

Candidate variants observed: `primary` (filled), `secondary` (outline, the `.btn` base),
`compact`/`sm` (`.btn.compact`, `GroupCard .button`, `StoryView .readThrough`), `quiet`
small action (`rowStyles.action` grammar: ghost bordered mini-action, min-height 24px).

| Site | Class | Content | Dis | Notes |
|---|---|---|---|---|
| routes/index.tsx:99 | `btn primary` | text | dis | landing submit |
| features/tokens/…/TokenSettings.tsx:105 | `btn primary` | text | dis | mint |
| TokenSettings.tsx:141 | `btn` | text | - | dismiss minted |
| TokenSettings.tsx:193 | `styles.revoke` | text | dis | local outline = Button sm |
| features/pulls/…/MarkReadyModal.tsx:207 | `btn` | text | dis | modal secondary |
| MarkReadyModal.tsx:215 | `btn primary` | text | a-dis | + aria-busy; focus-trap comment |
| features/pulls/…/PrBriefError.tsx:20 | `btn primary` on `<a>` | text | - | sign-in; needs `as="a"` |
| features/pulls/…/PullsSection.tsx:60 | `btn primary` on `<a>` | text | - | sign-in; needs `as="a"` |
| features/brief/…/BriefScreen.tsx:870 | `btn` | text | - | exit focus |
| features/brief/…/FocusBanner.tsx:57 | `btn` | text | - | exit |
| features/brief/…/ShortcutsModal.tsx:47 | `btn` | text | - | close |
| features/brief/…/Header.tsx:255 | `btn primary` | text | a-dis | mark ready; reference primary CTA |
| Header.tsx:274 | `btn primary` | text | - | submit review |
| features/brief/…/StoryView.tsx:71 | `styles.readThrough` | text | - | ≈ `.btn.compact` w/ panel2 fill |
| features/brief/…/GroupCard.tsx:298 | `styles.pickButton` | text | - | category pick; or segmented control if exclusive |
| GroupCard.tsx:407 | `styles.button` | text | dis | bulk Addressed |
| GroupCard.tsx:426 | `styles.button` | text | dis | bulk Dismissed |
| GroupCard.tsx:524 | `styles.button` | text | - | per-flag Addressed |
| GroupCard.tsx:537 | `styles.button` | text | - | per-flag Dismiss |
| features/conversation/…/ConversationSection.tsx:371 | `rowStyles.action` | text | dis | refresh; only `.action` with real `disabled` |
| features/conversation/…/DigestGroupView.tsx:100 | `rowStyles.action` | text | - | show more |
| DigestGroupView.tsx:122 | `rowStyles.action` | text | - | show more (PR comments) |
| features/conversation/…/RevisionJumpAction.tsx:39 | `rowStyles.action` | text | - | jump |
| RevisionJumpAction.tsx:50 | `rowStyles.action` | text | a-dis | + aria-describedby reason |
| features/conversation/…/ThreadDetail.tsx:156 | `rowStyles.action` | text | - | quote reply; aria-label disambiguates |
| ThreadDetail.tsx:175 | `rowStyles.action` | text | - | jump to comment |
| features/conversation/…/ReplyComposer.tsx:330 | `rowStyles.action` | text | a-dis | + aria-busy |
| ReplyComposer.tsx:347 | `rowStyles.action` | text | a-dis | + aria-busy; forwarded ref |
| features/conversation/…/ThreadResolveAction.tsx:47 | `rowStyles.action` | text | a-dis | + aria-busy, describedby; `data-state` testid hook |
| features/conversation/…/ConversationFilterPanel.tsx:174 | `btn compact` | text | a-dis | All |
| ConversationFilterPanel.tsx:190 | `btn compact` | text | a-dis | None |
| ConversationFilterPanel.tsx:203 | `btn compact` | text | a-dis | Clear |
| features/review/…/SubmitModal.tsx:189 | `btn` | text | - | keep reviewing |
| SubmitModal.tsx:192 | `btn primary` | text | - | continue |
| SubmitModal.tsx:260 | `btn` | text | - | preview receipt |
| SubmitModal.tsx:267 | `btn` | text | - | keep reviewing |
| SubmitModal.tsx:270 | `btn primary` | text | a-dis | + aria-busy, describedby; richest case, drives the API |
| SubmitModal.tsx:322 | `btn` | text | - | back to verdict |
| SubmitModal.tsx:329 | `btn` | text | - | keep reviewing |
| features/review/…/EvidenceModal.tsx:138 | `btn` | text | - | cancel |
| EvidenceModal.tsx:141 | `btn primary` | text | dis | confirm; inconsistent w/ SubmitModal:270 |
| features/review/…/DismissModal.tsx:47 | `btn` | text | - | cancel |
| DismissModal.tsx:50 | `btn primary` | text | - | dismiss |
| features/review/…/CommentComposer.tsx:89 | `btn primary` | text | - | submit |
| CommentComposer.tsx:92 | `btn` | text | - | cancel |
| features/review/…/CommentThread.tsx:141 | `btn primary` | text | dis | save |
| CommentThread.tsx:149 | `btn` | text | - | cancel |
| CommentThread.tsx:204 | `btn` | text | dis | delete draft (inline confirm) |
| CommentThread.tsx:215 | `btn` | text | - | keep |
| CommentThread.tsx:229 | `btn primary` + `data-post-cta` | text | dis | post CTA; data-* passthrough |

### FAMILY — other shared families (44)

**Icon-button (7).** Square/round ghost icon affordances, 3 size skins today
(24px ghost, 26px toolbar, 32px outlined stepper, 34px header):

| Site | Class | Notes |
|---|---|---|
| components/CopyButton/CopyButton.tsx:56 | `styles.copyButton` | 24px ghost; SR-only name; state recolors |
| components/MarkdownTextarea.tsx:279 | (`.toolbar button`) | 26px ghost, AL, a-dis, roving tabindex |
| features/pulls/…/DbTimelineNavigator.tsx:80 | `styles.arrow` | 32px outlined stepper, AL, a-dis ("never disabled: drops focus at ends") |
| DbTimelineNavigator.tsx:122 | `styles.arrow` | mirror |
| features/brief/…/BriefScreen.tsx:874 | `styles.shortcutsTrigger` | 34px circle `?`, AL |
| features/brief/…/Header.tsx:575 | `styles.menuTrigger` | 34px `⋯`, AL, haspopup — menu-trigger overlap |
| features/brief/…/BriefDetailsPanel.tsx:131 | `styles.trigger` | 18px `i` disclosure trigger, AL |

**Menu trigger (2) + menu item (5).** OrgSwitcher/LocalePicker are near-duplicates —
stronger consolidation case than the action button:

| Site | Class | Notes |
|---|---|---|
| features/installations/…/OrgSwitcher.tsx:101 | `styles.trigger` | outline + caret, haspopup/expanded |
| i18n/LocalePicker/LocalePicker.tsx:95 | `styles.trigger` | same shape, smaller |
| OrgSwitcher.tsx:139 | `styles.item` | menuitemradio, real `disabled` |
| OrgSwitcher.tsx:171 | `styles.defaultToggle` | menuitemcheckbox |
| LocalePicker.tsx:159 | `styles.item` | menuitemradio, roving tabindex |
| features/brief/…/Header.tsx:618 | `styles.menuItem` | role=menuitem |
| Header.tsx:633 | `styles.menuItem` | role=menuitem |

**Chip/pill (8):**

| Site | Class | Notes |
|---|---|---|
| features/conversation/…/ConversationFilterPanel.tsx:102 | `styles.chip` | aria-pressed toggle + count |
| ConversationFilterPanel.tsx:229 | `styles.chip` | aria-pressed toggle, bot |
| features/pulls/…/StaleRevisionChip.tsx:33 | `styles.chip` | amber status chip; span-swap when static |
| features/brief/…/BriefDetailsPanel.tsx:163 | `chipReset warningsChip` | amber count pill |
| features/brief/…/RiskChipDisclosure.tsx:62 | `styles.chipButton` | chip made interactive (reset idiom) |
| features/brief/…/RiskAttrsDisclosure.tsx:133 | `styles.chipButton` | same reset idiom |
| features/brief/…/IntentBar.tsx:113 | `styles.jump` | inline jump chip |

(7 rows — IntentBar:113 arguably link-family; counted here.)

**Row-as-button / row disclosure (7):** rows.module.scss `.rowButton` is the canonical
member; InlineThreads duplicates it.

| Site | Class | Notes |
|---|---|---|
| features/conversation/…/ThreadRowView.tsx:63 | `rowStyles.rowButton` + `data-variant` | slim/full densities; testid |
| features/conversation/…/PrCommentRow.tsx:29 | `rowStyles.rowButton` | aria-expanded |
| features/conversation/…/BotGroupRowView.tsx:39 | `rowStyles.rowButton` | aria-expanded |
| features/conversation/…/InlineThreads.tsx:57 | `styles.botButton` | near-verbatim `.rowButton` copy — dedupe |
| features/review/…/SubmitModal.tsx:174 | `modalStyles.unresolvedItem` | list-item card |
| features/pulls/…/MarkReadyModal.tsx:101 | `styles.unresolvedItem` | same shared Modal class |
| features/review/…/CommentThread.tsx:98 | (descendant selector) | collapsed card; **no aria-expanded** |

**Toolbar button / disclosure trigger (5):** the byte-identical triple + two full
disclosures:

| Site | Class | Notes |
|---|---|---|
| features/brief/…/ReadingToolbar.tsx:161 | `styles.tbtn` | aria-pressed |
| features/brief/…/FilterDisclosure.tsx:95 | `styles.trigger` | identical box; aria-expanded |
| features/brief/…/RiskAttrsDisclosure.tsx:79 | `styles.trigger` | identical box; aria-expanded |
| features/brief/…/StoryView.tsx:338 | `styles.railToggle` | rail expand/collapse |
| features/brief/…/IntentBar.tsx:212 | `styles.toggle` | "same disclosure grammar as conversation heading" |

**Stepper (4):** ReadingToolbar.tsx:189/197/220/228 — `styles.stepBtn`, 24px, AL.
(DbTimelineNavigator arrows counted under icon-button.)

**Tab (1):** MarkdownTextarea.tsx:249 — role=tab, roving tabindex.

**Disclosure, text-styled (2):** ExpandableContent.tsx:123 (link-like toggle,
aria-expanded/controls), ConversationSection.tsx:347 (`headingToggle` twist in `<h2>`).

**Link-button (4):** DigestGroupView.tsx:60 (`groupJump`, `font:inherit` in `<h3>`),
CommentThread.tsx:165/178/190 (Edit/Collapse/Delete via `.threadActions button`
descendant selector).

### BESPOKE (17)

| Site | Class | What it is |
|---|---|---|
| components/Drawer/Drawer.tsx:32 | `styles.scrim` | full-viewport dismissal scrim |
| features/pulls/…/MarkReadyModal.tsx:150 | `btn` | inline jump in prose — wants Button `link` variant |
| MarkReadyModal.tsx:166 | `btn` | same |
| MarkReadyModal.tsx:186 | `btn` | same |
| features/brief/…/Header.tsx:469 | `styles.chipInfoButton` | tooltip anchor, `cursor:help`, no onClick |
| features/brief/…/GroupCard.tsx:333 | `styles.infoButton` | tooltip anchor, same pattern |
| GroupCard.tsx:479 | `styles.fileButton` | link-like file-path jump |
| features/brief/…/SinceMarker.tsx:52 | `styles.deltaLink` | true inline text link |
| features/brief/…/SummarySection.tsx:41 | `styles.descriptionToggle` | link-like toggle; **no aria-expanded** |
| features/brief/…/StoryView.tsx:461 | `styles.railChunkButton` | multi-line card-as-button |
| features/brief/…/ChunkCard.tsx:179 | `styles.toggle` | disclosure w/ `user-select:text` requirement |
| features/brief/…/CoreLinesDisclosure.tsx:74 | `styles.trigger` | headless zero-specificity trigger wrapper |
| features/brief/…/ConcernView.tsx:54 | (descendant selector) | whole-row jump target |
| features/brief/…/GroupTocBar.tsx:127 | `styles.line` | mini-map tick w/ pseudo hit area |
| features/brief/…/RevisionGutterCell.tsx:42 | `styles.railButton` | invisible gutter overlay |
| features/brief/…/ReadThroughProgress.tsx:91 | `styles.segment` | progress segment as click target |

Note: MarkReadyModal:150/166/186 sit in BESPOKE only because today's `.btn` chrome is
wrong for them; if the spec adds a `link` variant they move to MIGRATE, joining the
link-like BESPOKE rows (GroupCard:479, SinceMarker:52, SummarySection:41) and the
link-button FAMILY rows as one decision: **is `link` a Button variant or its own
component?** That is the sharpest question this census hands the sibling-set grill.
