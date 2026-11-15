---
name: MergeBrief
description: A calm, dark reading surface for understanding a pull request before reviewing it.
colors:
  accent: "#e1e1e1"
  brand: "#e91f00"
  brand-strong: "#d81b00"
  on-brand: "#ffffff"
  ground: "#020203"
  focus-ground: "#000000"
  chrome: "#08080c"
  card: "#0d0d11"
  card-sunken: "#0a0a0e"
  surface-1: "#111116"
  surface-2: "#15151a"
  surface-3: "#1c1c21"
  text-1: "#ececef"
  text-soft: "#cacad1"
  text-2: "#9a9aa1"
  text-3: "#8d8d94"
  line: "#1f1f24"
  line-strong: "#2b2b31"
  control-edge: "#68686f"
  state-open: "#5fc88f"
  state-merged: "#a98fd1"
  state-closed: "#df6b7d"
  state-warning: "#d9a45c"
  concern-implementation: "#3a93ff"
  concern-test: "#c35000"
  concern-doc: "#00b472"
  concern-spec: "#a88100"
  concern-config: "#8f7dfa"
  concern-generated: "#b94399"
  concern-unattributed: "#7c7c87"
typography:
  display:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  group-title:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
  panel-title:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.35
  title:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  lead:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "clamp(0.875rem, round(0.8rem + 0.2vw, 0.25px), 0.9375rem)"
    fontWeight: 400
    lineHeight: 1.5
  reading:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.35
  caption:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
  code:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
rounded:
  xs: "2px"
  sm: "4px"
  chip: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
  circle: "50%"
spacing:
  "1": "2px"
  "2": "4px"
  "2-5": "6px"
  "3": "8px"
  "3-5": "10px"
  "4": "12px"
  "4-5": "14px"
  "5": "16px"
  "6": "24px"
  "7": "32px"
  "8": "48px"
  "9": "64px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.md}"
    height: "38px"
    padding: "8px 16px"
  button-secondary:
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    height: "38px"
    padding: "8px 16px"
  url-box:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.lg}"
    height: "44px"
  url-box-focus:
    backgroundColor: "{colors.surface-3}"
  list:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.lg}"
  list-row:
    height: "56px"
    padding: "8px 16px"
  list-row-hover:
    backgroundColor: "{colors.surface-2}"
  list-row-cursor:
    backgroundColor: "{colors.surface-3}"
  chip:
    textColor: "{colors.text-soft}"
    rounded: "{rounded.chip}"
    height: "20px"
    padding: "0 6px"
  filter:
    rounded: "{rounded.md}"
    height: "28px"
  filter-changed:
    textColor: "{colors.accent}"
  menu:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.lg}"
    padding: "24px"
    width: "460px"
  bottom-sheet:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.lg}"
  toast:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  settings-rail:
    width: "184px"
  phone-row:
    height: "44px"
  phone-chunk-head:
    height: "56px"
  phone-bar:
    height: "56px"
  avatar:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.circle}"
    size: "26px"
---

# Design System: MergeBrief

Status: built on Home, which leads this language; the Brief page follows it. The palette is the one the Brief page was designed on, expressed as tokens: hue 286, the greys at chroma 0.01 and the accent a white at chroma 0. The hex values above are what that renders today, and the source of truth is four numbers in `apps/web/src/styles/tokens.scss`. Nothing on screen carries the hue but the greys. There is no info colour: a note that is neither a state nor the brand is neutral, and its words or icon carry it.

## Overview

**Creative North Star: "The reading room"**

The product takes a pull request that is hard to read and makes it easy to read. The interface is the room you read it in at night: a dark page, text that is calm and large enough, and nothing blinking for attention. The room is lit by nothing but the type. The three words it aims for are calm, mine, ready.

Calm comes from neutral greys and one pale accent. Structure comes from hairlines, not from raised cards. Impressive means exact alignment, generous type and instant response, never decoration.

**Key Characteristics:**

- Dark only. A near-black page, flat from edge to edge; no glow, no page gradient and no backdrop blur, focus mode included.
- Hairline borders and row dividers. No card per row.
- One accent. It marks what needs the reviewer, and focus. The brand colour draws the mark, fills the one primary action and runs the Brief header's review progress bar.
- Two-line rows of 56 to 57px. Titles at 15px; the smallest text is 11px.
- Motion is rare and short. Keyboard movement never animates.

Never: a dashboard of stat tiles, a greeting, all-caps labels, monospace used as decoration, a badge on everything. The one exception is the verification receipt's summary: three tiles (chunks read, flags open, inline comments) under its outcome, each drawn as a Line edge with no fill, so none sits below the dialog.

## Colors

Neutral greys under one light accent. State colours keep a fixed meaning across the product.

### Primary

- **Accent** (#e1e1e1, the `--accent-400` primitive, a white at 91% lightness and chroma 0): review marks for rows that need the reviewer, focus rings, links, active controls, the selected diff rows, the revision marks, the value of a changed filter, the current page and the avatar's ground.
- **Brand** (#e91f00, `--color-brand`): the mark wherever it appears (the Header lockup, the Brief header's home link, the sign-in page), the Brief header's review progress bar, and the fill of the one primary action per view under **On Brand**, a pure white label at 4.51:1. **Brand Strong** (#d81b00) is the primary's hover and press.

### Neutral

- **Ground** (#020203): the page and the Header, one ground with no band. Focus mode drops to **Focus Ground**, black, one flat fill, so it stays below the page.
- **Chrome** (`--color-chrome`, Surface 1 at 45% over the ground, about #08080c): the Brief header's compare row and the sidebar's column, panel and narrow bar, one fill so they cannot drift apart.
- **Card** (`--color-card`, Surface 1 at 80% over the ground in OKLCH, about #0d0d11): the Brief's three reading surfaces, one fill so they match: the change-group card, the fold group (Original description, Intent check, Conversation) and the side facts card (Generated by, Split). A fold row's hover lifts to Surface 2; what sits inside an open fold is flat on the card, never a lighter box, except a Product change.
- **Card Sunken** (`--color-card-sunken`, Card and Chrome in equal parts in OKLCH, about #0a0a0e): the frame of one Product change inside the open Product diff fold, half a step below the card so each change reads as one block. Its After half lifts to Surface 2.
- **Scrim** (black at 55%): behind dialogs and sheets.
- **Surface 1, 2, 3** (#111116, #15151a, #1c1c21): the list, then hover and the URL box, then menus, the keyboard cursor row and the focused URL box.
- **Well** (Ground 25% into Surface 1, about #0d0d11, the same fill as Card by a different mix): the diff's code and a chunk's head, a step below the Surface 1 chunk card it sits in.
- **Text 1** (#ececef): titles that need the reviewer (new, updated since your review, in progress), headings.
- **Text Soft** (#cacad1): titles that do not (reviewed, or the viewer's own), chip text.
- **Text 2** (#9a9aa1): the second line of a row, labels, quiet icons.
- **Text 3** (#8d8d94): placeholder text and unreachable rows. The floor for readable text, set so it clears 5:1 on Surface 3.
- **Line, Line Strong** (#1f1f24, #2b2b31): row dividers and the list edge, then the borders of buttons, filters and frames.
- **Control Edge** (#68686f, `--color-control-edge`): a form control's edge at rest: a checkbox's box, and every text field and select, the URL box and the Markdown field included.

### State (fixed meaning, hue may be tuned)

- **Open** (#5fc88f), **Merged** (#a98fd1), **Closed and failed** (#df6b7d, a crimson; deleted lines, errors and the Danger edge take it too, and deleted-line text is #ebd0d2), **Warning** (#d9a45c). Draft is Text 2 with its own icon shape.

### State tints

A state fill is its colour over transparent at one of four strengths, each about half again the one below: **Faint** 5% (`--tint-faint`), **Subtle** 8%, **Medium** 12% and **Strong** 18%. Warning, crimson, green and the accent read them through `--color-<state>-tint-<strength>` tokens (`--color-warning-tint-medium`), and a fill whose colour varies by row or badge mixes its colour at a strength token. Faint washes an added or deleted line and the sign-in failure box. Subtle is the accent tint and the generation warnings chip. Medium is a chip, a badge, the danger hover, the pager's current page, the ticket notice and an added or removed diff row under the pointer. Strong is a warning chip under the pointer and a word-diff mark. An edge in a state colour, an unchanged diff row's 6% of Text 1 under the pointer, the selected diff row's 14% and 24%, the revision wash, the scroll flash and a surface lifted toward the accent are each their component's own.

### Concern (marks only)

- **Implementation** (#3a93ff), **Test** (#c35000, an orange), **Doc** (#00b472), **Spec** (#a88100, an olive), **Config** (#8f7dfa), **Generated** (#b94399, a magenta), and **Unattributed** (#7c7c87), the one neutral. The hues sit at OKLCH chroma 0.13 to 0.18 and lightness 57% to 68%. In this order neighbours alternate light and dark, at least four points apart, except Generated beside Unattributed, where the neutral's missing chroma does the separating. Hue alone parts Implementation from Config and Test from Generated, so the legend names every segment and colour never carries the split alone. A concern colour draws a dot or a split segment, never a word or a fill.

### Named Rules

**The Brand Colour Rule.** The brand appears in three places only: brand moments (the mark, its loader, the app tile), the one primary action of a view, and the Brief header's review progress bar. It is never a state, a link, focus, selection or decoration, and a view without a primary action shows no brand fill. Its label is pure white, so the primary only ever darkens on hover and press.

**The Light Accent Rule.** The accent is always light: it draws small marks on a dark page (focus, links, active controls, selection, the cursor and revision marks) and is never the primary button's fill; that is the brand's. It reads as a light, not a paint: high lightness and low chroma, a white with a hue rather than a saturated colour. A dark or heavily saturated brand colour needs a lighter partner for the interface. Today the chroma is 0: the accent is a white at 91% lightness and carries its meaning by lightness alone.

**The One Hue Rule.** The theme is four numbers in `tokens.scss`: `--theme-hue`, the accent's `--accent-l` and `--accent-c`, and the greys' `--gray-c`. The accent and every grey derive from the hue in OKLCH at fixed lightness steps, so changing the hue moves the whole palette together and every contrast holds. Nothing else in the app states the hue.

**The Four Lanes Rule.** Green, violet, crimson and amber belong to states, and vermilion to the brand. A hue inside one of them reads as that state or as the brand. Crimson sits 19° from the brand and stays apart on chroma, 62% of the brand's; the lane-separation test holds every state and concern colour within 20° of the brand's OKLCH hue to at least 0.05 darker or at most 75% of its chroma. The free lanes are blue to teal and pink to magenta; Implementation and Generated draw from them. The concern marks are the one exception: Doc shares Open's green and Spec sits by Warning's amber, apart only by sitting darker; Test sits 14° from the brand and clears its lane on chroma alone, 71% of the brand's; and Config sits beside Merged in the violet lane at nearly its lightness. Context carries the rest: a concern mark always sits beside its concern's name, and a state colour never does.

**The Tinted Grey Rule.** Greys carry the hue at one very low chroma, `--gray-c`, 0.01 at hue 286; the decorative grey doubles it and Text 1 takes a third, so the brightest grey stays within two steps of neutral on every channel. When the theme hue (`--theme-hue`) changes, the greys move with it, at the same lightness, so contrast holds; a hue whose tint reads too strong on the greys turns `--gray-c` down, and 0 makes every grey neutral without touching the accent. In OKLCH lightness: ground 0.08 (the focus ground is black, 0), surfaces 0.179, 0.198 and 0.229, lines 0.241 and 0.292, a raised edge 0.39 (the composer's submit), the control edge 0.52, the ghost separator 0.355, text 0.944, 0.84, 0.689 and 0.645, accent 0.91 at chroma 0. Surface 3 sits below Line on purpose: a menu's fill is darker than the hairline that edges it.

**Contrast.** Text is 5:1 or better on every surface it sits on, and 5.5:1 or better on the page and the list; icons and state marks 3:1 or better. The palette contrast test in `apps/web/src/styles` holds those lines against the tokens; a pair below its line fails the test suite. A form control's edge at rest is 3:1 or better on every surface a control sits on or holds, the Inbox's selected row included, and a checkbox lifts it 40% toward Text 1 under the pointer. One deliberate exception: a selected diff row lifts the well by 14% of the accent, its number cells by 24%; code and syntax colours read against the row at the AA line, 4.5:1 or better, and the numbers take Text 1 against the number cells, which the same test holds. The primary's white label is held at the AA line, 4.5:1, on the brand and on Brand Strong. A badge's words are held there too, on their own 12% tint over every surface, at rest and under the pointer. Focus always shows a 2px accent ring, except in the Markdown field, which marks focus with its own edge in accent and a soft accent glow inside it (`--shadow-field-focus`).

## Typography

**Display and Body Font:** IBM Plex Sans (with -apple-system, Helvetica Neue, sans-serif)
**Code Font:** IBM Plex Mono, for code and what identifies code

Both are self-hosted through `@fontsource`, every subset behind its `unicode-range` so a Latin page downloads Latin alone and a Cyrillic line still sets in Plex (Plex Mono ships no Greek); sans and mono each at 400, 500 and 600. The two body files (sans 400, mono 400) are preloaded from the root route so the fallback never flashes; no font loads from a third-party origin.

**Character:** One family at every size. Hierarchy comes from size, weight and the step from Text 1 to Text 2, not from a second typeface. The scale is seven steps: 11, 13, 15, 17, 20, 24 and 30px, stated in rem so it follows the reader's browser font size. Weights are 400, 500 and 600; nothing else loads. The tokens number the steps from the smallest, `--font-size-1` (Caption) to `--font-size-7` (Display).

Line height takes one of six steps, each a `--line-height-*` token named for its job: control 1 for single-line controls, display 1.1, heading 1.2, compact 1.35 for UI text, body 1.5 and reading 1.7 for code and long reading text. A row whose height other code counts sets a fixed line box instead: 16, 18, 20 or 22px. The diff row is the exception: 13px code on the reading step makes its 22px row, and a stylesheet test holds that product to the chunk height model's row height.

The root stays at the browser's size, 16px by default. Only `body` is fluid: a clamp of 14 to 15px on `round(0.8rem + 0.2vw, 0.25px)`, which lands on quarter pixels (14.25 at 750 wide, 14.75 at 1000). That off-scale value is deliberate, and it reaches only text that inherits and names no step. Text fields take one more off-scale size on a touch screen, 16px, because iOS Safari zooms into a field set smaller.

### Hierarchy

- **Display** (600, 1.875rem, 1.1, -0.02em): the personal line on Home and the Settings heading. One per screen. Under 760px it steps down to 24px.
- **Headline** (600, 1.5rem, 1.2): the Brief's title at rest. The Brief's title collapses to 13px once the page scrolls; on a phone it is 20px in the page and 13px in the row.
- **Group title** (600, 1.25rem, 1.2): a change group's name in its card and in the focus panel, and the summary's Overview and Changelog headings.
- **Panel title** (600, 1.0625rem, 1.35): dialog titles, Settings panel headings and the sign-in heading.
- **Title** (600, 0.9375rem, 1.2): section headings such as the list heading, and the brief's fold rows (Original description, Intent check, Conversation) at a 1.35 line.
- **Row title** (500, Text 1 when it needs the reviewer and Text Soft otherwise, whatever the layout, 0.9375rem, 20px line): one line, cut with an ellipsis.
- **Lead** (400, 1.0625rem, 1.5): the line under the personal line, 62 characters wide at most. The sign-in lead is Small in Text 2.
- **Reading** (400, 0.9375rem, 1.7, Text Soft): the words of a brief, its overview, changelog and summaries, and the Instance tab's count, cap and refusal copy.
- **Small** (400 to 600, 0.8125rem): controls, menus, the pager, code, a change group's meta line and since marker, the masthead's fact rows, the second line of a row with an 18px line and tabular numerals, the chunk and focus indicators with tabular numerals, and the URL box's slash hint. Running text sets at 400; chips, the chunk indicator and the focus indicator's label and current count at 500; titles and figures inside a panel at 600; buttons at 400 to 600. The shortcuts dialog's section headings take the Title step.
- **Caption** (400, 500 or 600, 0.6875rem): the Brief page's badges and the chunk and sidebar meta rows, a group's category chips, the generation warnings chip, the change stepper's count outside the Brief controls sheet, small section labels and every other key cap. Nothing smaller ships.

### Named Rules

**The No Shouting Rule.** No all-caps labels and no letter-spaced small caps anywhere.

**The Code Only Rule.** Monospace appears only for code and what identifies code. The whole list: inline code and code blocks, diffs with their line numbers, file paths, commit hashes, branch names, model ids with the effort beside them, and key caps. Everything else is the sans, and a count sets in the sans with tabular numerals: header stats, added and deleted lines, positions like Group 1 of 3, labels, chips and headings.

**The Amber Rule.** Amber means look here or this brief may be wrong, nothing else: risk attributes (the chips, the Risk attributes count and the group card's risk notes), generation warnings, repo-config trouble, a group's Uncertain classification chip, and the Submit dialog's warning that the pull request has newer commits. A de-emphasised risk attribute drops to neutral. Its deliberate exceptions are cautions someone must act on: the Settings spend meter near or at its cap and the capped note, the version notice, a primary ticket that could not be read and the diff-timeout notice. A misaligned ticket read stays neutral. Gold is not amber: it belongs to the landing page, the docs and brand badges, never to a state. A Home row's New commits chip is not a warning: new commits are a change to read, so it takes the accent tint. The Brief's own Newer commits control takes the accent tint. "Not an approval" is a neutral fact chip.

## Layout

One centred column, 1080px wide at most, with a 24px gutter that becomes 16px under 760px; the header shares the gutter, so its lockup and account trigger line up with the column. The Header is one 52px tier, transparent, with a Line hairline under it. Its left end is the lockup, one link named MergeBrief: the mark in Brand at 1.3em beside the wordmark at 20px, 0.4em apart, the wordmark in Text 1. Its right end is the account trigger: a pill holding the avatar, concentric in the pill's cap, and a caret; its menu offers Settings, a Language group where language selection is enabled, Keyboard shortcuts (not on touch) and Sign out.

Spacing uses one scale: 2, 4, 6, 8, 10, 12, 14, 16, 24, 32, 48, 64. The 6, 10 and 14px steps sit between whole steps and are named `--space-2-5`, `--space-3-5` and `--space-4-5`. Blocks are grouped, not evenly spaced: the personal line and the URL box sit 16px apart as one group; the list begins 48px below them; a heading sits 12px above its list. There is always more space above a heading than below it.

The list splits at a fold. Rows that need the reviewer (open, not a draft, and new, updated since your review or in progress) come first; a quiet line reading "Not waiting on you" follows; reviewed rows, drafts, merged or closed rows and the viewer's own come last. The personal line above counts the rows the fold lifts ("5 pull requests need your attention") and lists their states, what changed since your review first; with nothing waiting it reads "You are all caught up". Each group keeps the chosen sort. A View control beside Sort offers the other layout, "Mixed": one list in the sort's order with no fold. The choice rides the URL and is not a filter, so Clear leaves it.

Under 760px the filters collapse behind one button and the controls take their own line; under 400px View and Sort may wrap under the Filters button. Status labels become icons with hidden text. The page never scrolls sideways down to 320px.

**Sign-in.** A signed-out viewer of any page gets one panel centred on the ground, 384px wide at most, with no header: Surface 1, a Line edge and a 12px corner. Inside sit the 24px mark in Brand beside the wordmark, a Panel title heading, a Small lead and a full-width 40px primary button, with one quiet note in a hairline footer. A refused account shows its reason in a failure box above the button.

**Settings.** Home's shell: the same Header, gutter and column, with the heading in Display and the panel 32px below it (24px under 760px). A viewer with one tab gets no rail. An Operator gets a 184px rail beside the panel, 48px apart and pinned 24px from the top, where the current tab takes Surface 3 on an 8px corner. On a phone the rail becomes a row of tabs over a hairline.

**Brief page.** Above phone width the header keeps two tiers, solid on the ground. Its home link is the 32px mark alone, in Brand, named MergeBrief. At 1120px and under the sidebar becomes a bar along the bottom that opens its lists in a bottom sheet. The reading toolbar rests as a 12px-corner panel in the story column; pinned under the header, its fill runs from the screen's left edge to the sidebar's edge (the rail, or the open panel where it pushes the story), square, keeping only its bottom hairline, and its controls stay where they were. A chunk's head pinned under the stack squares its top corners, and so does a group's card where it pins beside its chunks; stacked under them, it never pins. Each change runs both ways over 180ms on the entrance curve: the toolbar's fill opens from the panel to the bleed while its panel border fades, and the corners square. A page that loads already scrolled, or a pane shown again while scrolled, shows the pinned look at once, and reduced motion makes every change instant. The review progress bar runs under the header's bottom hairline, 3px and as wide as the header: Brand at 60% at the left edge, full Brand at 70% of the fill, lightening toward white at the leading edge. It rides the header's collapse with the header's edge, so it never crosses the comparison row.

**Phone reader.** A phone is 880px wide or less, or sideways: `(orientation: landscape) and (height <= 500px) and (width <= 1120px) and (pointer: coarse)`. Height keys the sideways case because a large phone lands past the width line, the coarse pointer keeps a short desktop window out, and the orientation keeps a split-screen portrait pane upright. Upright, three bars frame the reading, 44 + 56 + 56: a 44px row with back and the 24px mark, then the title once the page title has scrolled away; a chunk's 56px two-line head pinned under it, with the path over its counts and Viewed; a 56px bar at the bottom edge with Brief controls, the chunk indicator that opens the Sidebar sheet, and previous and next, which Changes leaves out because its chunks are not on the page. Sideways, all of it folds into one 44px row, and a chunk's head parks behind the row, which names the chunk from then on; a fold or Viewed from the row that collapses the chunk parks its head there too. Focus mode has no row, so its head stays pinned. Controls in these bars are 44px targets. The bottom bar pads for the home indicator and the sideways row for the notch, both from safe-area insets.

## Elevation & Depth

Flat, with tonal layering. Surfaces step up in brightness; hairlines draw the edges. Shadows appear only on things that float or that invite input. Everything that sits over content is solid, sticky bars and focus mode's floating pieces included, so code never shows through a control. No backdrop blur ships.

**Stacking.** What overlaps follows one order, lowest first: a diff's rail button and a floating mention list, a pinned chunk head's corners and the head, the self-review tooltip, the warming chip, the reading toolbar, the intent legend, the sidebar, the reanchor banner, the Header with its progress bar, focus mode's strip and shortcuts, its panel, scrim and sheet, the narrow sidebar, the phone bar, the bottom sheet, dialogs, the navigation bar, the segmented control's tip, the skip link, a popover's scrim and every popover, menu and callout, then the toast. A panel opened inside a bar (the reading toolbar's filter and risk panels, the header's newer-commits explanation) orders only within its bar: it paints over the bar's own contents, the header's progress bar included, and never over anything that paints over the bar.

**The Mechanism Gradient Rule.** A gradient never colours a surface. It survives only as a mechanism: the URL box's submit sweep, the scroll-edge shadows on the Sidebar's lists and a group card's file list, skeleton shimmer, a changed line's wash in a compared diff, the hatch on an empty split cell and a media placeholder, the fade at the foot of a clamped comment, the mask at the media strip's edge, and the review progress bar's ramp toward its leading edge.

### Shadow Vocabulary

- **URL box at rest** (`inset 0 0 0 1px` of Control Edge, plus `--shadow-lift`, `0 14px 32px -16px rgb(0 0 0 / 60%)`): a control's edge and a soft lift.
- **URL box focused** (the same edge, plus `--shadow-lift-focus`: `0 0 0 2px` of the accent at 50% and `0 18px 40px -16px` of the accent at 16%).
- **What floats** (`0 18px 44px -10px rgb(0 0 0 / 70%)`): menus, popovers, callouts, dialogs over their scrim, and focus mode's pill and panel.
- **Raised in place** (`0 12px 40px rgb(0 0 0 / 22%)`, `--shadow-raised`): a comment thread and an addressed comment in the diff, the mention list and the self-review chip's popover.
- **Tooltips** (`0 4px 12px rgb(0 0 0 / 40%)`): a compact callout, a one-line label rather than a surface.
- **Toasts and sheets** (`0 16px 48px rgb(0 0 0 / 55%)`).
- **Markdown field focused** (`inset 0 0 0 3px` of the accent at 16%): a soft glow inside the field's accent edge.

## Shapes

Small, consistent corners on four steps: 4px for key caps and inner corners, 6px for chips, badges and tooltips, 8px for controls and toasts, 12px for every surface: the list, the URL box, menus, callouts, dialogs and a sheet's top corners. A surface's inner corner is its radius less its inset. Five tokens carry them: `--radius-xs` (2px, a sliver for bars and markers), `--radius-sm` (4px), `--radius-chip` (6px), `--radius-md` (8px) and `--radius-lg` (12px). Four are named by size and one by the role that wears it, so a chip follows its role rather than a neighbour's step. Round is kept for people, on two more tokens: the avatar is a circle (`--radius-circle`, 50%) and the account trigger a pill (`--radius-pill`, 999px). The pill has two more uses. A status pill that rides inside a line of text or a diff takes it: the read-only chip, a revision tag, the warming chip, a thread count, a conversation chip and a Changes-only group's category, as do focus mode's pill and tab and the details `i`. So do marks with no corner to speak of: a spinner, a progress fill, a scrollbar thumb, a status dot and the sheet's grip. Borders are 1px. Chips are filled with a soft tint and have no border. Review marks are drawings from the icon set on its 16px grid: a filled circle (new), a filled half circle (in progress), a ringed dot (updated since your review), a ringed check (reviewed).

## Icons

One family, Phosphor, copied icon by icon into `apps/web/src/components/icons/<phosphor-name>.svg`; no dependency, and no second folder. The file name is Phosphor's name; the meaning lives at the site, not in the file.

- **Grid and weight.** A 16px grid at the Bold weight, which is a 1.5px stroke at 16px; the stroke scales with the box, about 1.3px at 14 and 1.1px at 12.
- **Three sizes.** 12 inside a chip, 14 inside a control (icon button, toolbar, pager, menu row), 16 in a row or a state. Nothing else without a stated reason.
- **Colour.** `currentColor`, set by the site's token.
- **Fill.** Stroke by default. Fill is the "on" form of the same icon (selected, active, checked), plus the icons whose meaning is the fill: the four review marks.
- **Direction by rotation.** One `caret-down` for every caret and disclosure, one `arrow-up` for every arrow, turned in quarter steps by CSS. No mirrored files.
- **The `Icon` component** owns the contract: `name` from the set, `size` (12, 14, 16), `color`, `rotation`, `className` and an optional `label`. Without a label it is decorative, `aria-hidden` with `focusable="false"`, and the control or row around it carries the meaning; with one it takes `role="img"`. An override is a visible prop, never a second file.
- **Brand glyphs** (GitHub, the provider marks) ride the same component and props; their own viewBox and fill are the only difference. A full logo, and the product's own mark, sit outside the set: `mergebrief-mark.svg` and `mergebrief-wordmark.svg` are committed files, the wordmark Archivo at width 112, weight 700 and -0.015em tracking outlined to paths, so no font loads for it. Clear space around the mark is at least 1/8 of its height.
- **Text glyphs** are typography, not icons: `↳`, `▪`, `×` and `·` stay text, the spinner stays CSS, and the mark loader reuses the mark's own file. Every other glyph is an svg from the set.

## Components

One skin on both pages: corner, edge, fill and the hover, pressed and selected tints are shared; each page keeps its own sizes, padding and type.

### Buttons

- **Shape:** 8px corner; a small Button takes the 4px corner, except Ghost and the danger ghost. Every variant takes its height from padding and the body line-height, about 38px, so a confirm and its Cancel sit level; the URL box sizes its own Generate at 32px inside the field.
- **Primary:** Brand fill under a white label: the primary action of a view, Generate on Home, Submit and the dialogs' confirm on the Brief page, Sign in. One per view: on the Brief page the header's Submit is it, so a chunk's Next and a thread's Post and Save take Secondary, and a comment composer's submit takes Secondary raised on Surface 2 behind the 0.39 grey edge (`--color-line-raised`), a step above its ghost Cancel. Hover takes Brand Strong and press mixes 12% of the ground into it in sRGB, so a primary only darkens and keeps its hue. The Submit button's draft count sits on black at 50% under a white number.
- **Secondary:** transparent with a Line Strong border.
- **Danger:** outline only: crimson text and a crimson edge at 55% over Line Strong; hover lifts the edge to full crimson over a 12% crimson tint. There is no filled Danger. In a destructive dialog Cancel and the confirm carry equal weight, so the heading asks the question, the body says what cannot be undone, and focus lands on Cancel.
- **Disabled:** the variant's own edge, fill and label at 45% opacity (`--opacity-disabled`), with no hover or press change, so a disabled button keeps its shape and reads as a button. It stays focusable; while it shows the focus ring the edge, fill and its own text stay at 45% as colour and everything inside it at 45% opacity, rather than the whole element, so the ring keeps full strength and the control, a row's risk label, path and caption included, still reads as disabled. Every shared control that refuses does the same: icon buttons, toolbar buttons, chips, row buttons, link buttons, a segmented control's unavailable option, menu rows and the pager. A checkbox is natively disabled and leaves the tab order, so it only dims. A menu row that states why it is unavailable dims its label to the same 45% as colour and keeps the reason at full strength.
- **Ghost:** no edge or fill, Text 2, Surface 3 under the pointer with Text 1, on the 8px corner at either size: actions in a bar beside text, such as the Home selection row, and the comment composer's Cancel. The danger ghost keeps crimson ink and takes a 12% crimson tint under the pointer.
- **Icon buttons:** borderless, Text 2, Surface 3 under the pointer with Text 1. The triggers that need a visible edge (the account trigger's pill, the details trigger's ring) draw their own.
- **Press:** a Button or icon button scales to 0.97 over 120ms on the entrance curve; a toolbar button never scales, it can be a full-width heading, so it takes a background step instead, as rows and tabs do. No hover movement anywhere.

**The Hover Rule.** Every hover style sits behind `(hover: hover)`, so a tap never leaves one stuck. A control that hover reveals on a pointer has a touch route: visible at rest, or behind an explicit mode or menu, as a row's actions and checkbox are.

### URL box

- **Style:** Surface 2 fill, Control Edge, soft shadow, 12px corner, 44px tall. A link icon leads; the slash key hint sits at the end and gives way to the Generate button once text is entered.
- **Focus:** Surface 3 fill, 2px accent ring, accent-cast shadow. The icon turns accent.
- **Submitting:** the field is replaced by one line of status and a thin accent sweep along the bottom edge.

### List and rows

- **Container:** Surface 1, 1px Line edge, 12px corner, Line dividers between rows. No card per row.
- **Row:** two lines, 56px for the first row of a list and 57px after it, where the divider adds one. Line one is the mark, the title and chips. Line two is another author's chip when the row is someone else's, the source icon (URL pull requests only), repository, number and age, in Label type, on one baseline. Inline code in a title takes a chip. A code chip wider than the row is cut inside itself; a chip that follows words and doesn't fit is replaced whole by the title's ellipsis.
- **Right edge:** generation state (generating, queued, failed) and the status, right-aligned and flush. Status is printed only when it is not Open.
- **Hover:** Surface 2. Actions sit in their own column at the row's end and fade in (opacity only, 120ms): Open on GitHub, and a menu with Copy link, Open on GitHub, Archive, Delete on the viewer's own URL rows and on installation rows in repositories the viewer administers, Delete attachment branch on those installation rows, and Regenerate leading it when a pasted row is behind, unless its last generation failed in a way a repeat paste fails again. On touch only the menu stays visible, so a phone row keeps its width for the title and repository.
- **Selecting:** the mark and the checkbox share one 20px slot at the row's start; the box takes the mark's place on hover, keyboard focus or while selecting, so a reveal moves nothing. On touch the slot keeps the mark and a tap on it opens the brief until Select is pressed. A selection row sits under the filters on its own line, so the filters stay in view while rows are ticked: at rest it holds the page checkbox and the total ("11 briefs", or "Showing 10 of 24 briefs" past one page), plus Select on touch; once selecting, every row's box shows and the row takes a surface with the count and ghost Archive, Delete and Clear selection.
- **Keyboard cursor:** Surface 3 plus a 1px inset accent ring at 55%. It appears and moves with no animation. On the Brief page the current chunk wears the same ring on its own edge, over Surface 1.
- **Accessible name:** the row link reads the review state, status, generation state and source in words before the title. The mark sits in the row's lead slot, outside the link, with a callout naming its state after a pointer rest or on keyboard focus; icons are hidden from assistive technology.

### Chips

- **Style:** 6px corner (a status pill takes the pill, see Shapes), soft tint (Text 1 at 7%), no border, the sans at 500 in Text Soft. A fact chip is 20px tall and states one thing about a row or a dialog: place in a stack, new commits (in the accent tint), unreachable, the review outcome above the receipt's tiles, and "Not an approval" in the receipt header, in Text 2. A filter chip keeps the Brief page's 26px and its check glyph.
- **States:** a pressed chip takes the accent tint, accent at 8% behind a 45% accent edge, with accent text; a warning chip sits on a 12% warning tint in Warning.
- **Badge:** the chip corner on a 12% tint of its colour, weight 500, no border, and the words in their own case. The Brief header is the exception: its status and stack chips sit on the page ground with no list around them, so each keeps an edge, the status chip in its own colour at 35% and the neutral stack chip in Line Strong. A risk badge from repo policy alone draws a dashed edge in its colour, and a de-emphasized one a dotted edge. A badge that links keeps its tint under the pointer, draws its edge in its colour at 35% and lifts its words a fifth of the way to Text 1, as a link lifts; a deeper tint would take Closed below 4:1 on Surface 3.

### Filters, sort and pager

- **Filter:** 28px, 8px corner, Line Strong border, Text 1, Surface 2 under the pointer. It shows its name only; a value appears when it is set, and several values show as a count. A changed filter takes the accent tint and an accent value. Every multi-select filter opens with an "All …" row, ticked while nothing narrower is chosen; Status's ticks all four statuses. Author, List and Installation fold under More filters. Clear sits beside View and Sort.
- **Toolbar buttons and the segmented control** on the Brief page wear the filter's skin: the same edge and corner, the accent tint when pressed or active; the active segment adds a 1px inset accent edge. A mixed state keeps a dashed edge so it never rests on colour alone. The reading toolbar's own strip is the exception: its triggers are ghosts, with no edge at rest, Text 2 lifting to Text 1, the same accent tint when pressed, and the background step on press; "What these mean" keeps the boxed skin.
- **Review filter:** lists each review mark beside its name and doubles as the legend.
- **View:** Needs you first (the fold) or Mixed (one list). Named like a filter: its value shows once changed.
- **Pager:** numbered, 30px bordered squares; the current page takes the accent tint. The range reads "1 to 25 of 290".

### Menus and callouts

- **Menu:** Surface 3, Line Strong border, 12px corner, the float shadow. Opens from its trigger's corner: opacity and scale from 0.97 over 180ms, ease-out. Items are Text 1 with Line Strong at 40% under the pointer. A menu that stays open while its content changes does not replay its entrance. On a phone the Brief's Filter and Risk attributes panels, which open inside Brief controls, rise as a sheet of their own instead, with no handle: up to 70% of the viewport upright, the space under the row sideways. Under 760px Home's filters open on the Bottom sheet.
- **Callout:** the menu's surface, edge, corner and shadow. A compact callout is the tooltip tier: a one-line name with the chip's 6px corner and the tooltip shadow. Opens after a 350ms pointer rest, or at once on keyboard focus where the anchor is focusable; a touch never opens it by hover. Escape dismisses an open callout and is consumed, so with a callout showing, under a resting pointer or on a focused control, a dialog or shortcut takes a second press. It enters like a menu, opacity and scale from 0.97 over 180ms, and takes no space when hidden. Within 600ms of one leaving, the next opens with no delay and no entrance. The SegmentedControl's own instant tip on the Brief page has not moved onto it yet; it wears the tooltip tier's corner, shadow and padding.
- **Dialog:** Surface 3 behind a Line Strong edge, 12px corner, the float shadow, 24px padding, 460px wide, 560 for Mark ready and the risk attribute evidence dialog and 640 for the Submit and shortcuts dialogs, over the scrim. One header and one footer: the Panel title with an optional 13px detail and a close button at its end, then right-aligned actions with Cancel before the primary. The box is the dialog's scroller and the footer pins to its bottom edge, so the actions stay reachable on a sideways phone. Two exceptions scroll a region inside the box so the header and footer stay put: the unresolved list in the Submit advisory and Mark ready, whose box caps at 720px or the viewport less 96px, whichever is smaller, and on a screen 500px tall or less takes the viewport less 24px like any other dialog; and the verification receipt's body, which holds the outcome, the tiles and a fixed-height section panel that scrolls on its own; its tab row scrolls sideways where its tabs do not fit, and scrolling past the end of the section panel carries on to the body, except where the primary pointer is coarse and the screen is taller than 500px: there it stops at the panel's end, whichever input scrolls. Where either region at its smallest still does not fit, the whole box scrolls like any other dialog: the header scrolls away and the footer stays pinned. On a screen 500px tall or less, a drag past the end of an inner scroller carries on to the one around it and stops at the box. The scrim fades and the box takes opacity and scale from 0.98 over 180ms on the entrance curve; both leave over 120ms. The box itself never shows a focus ring; a dialog with one obvious first control (the dismiss reason field) focuses it on open, any other lands on the box.

### Bottom sheet

The one sheet on narrow screens. It holds the Sidebar sheet, Brief controls, a chunk's menu and, under 760px, Home's filters: every filter in one list, grouped under its name, that stays open across choices.

- **Style:** Surface 1 under a Line Strong top edge, 12px top corners, the sheet shadow, over the scrim, and always above the phone bar and the narrow sidebar bar.
- **Height:** half the viewport, with a 40 by 4px grip in a 72 by 24px handle that grows it to the space under the pinned stack; on Home, with no pinned stack, it grows to the full viewport. Sideways it opens at that full height, with no handle.
- **Motion:** it rises over 320ms on the entrance curve while the scrim fades over 180ms; the height change takes 180ms on the on-screen curve.

### Toast and navigation bar

- **Toast:** Surface 3, Line Strong edge, 8px corner, the sheet shadow, Small at 500 in Text 1, 28px above the bottom and above any bar, 560px wide at most. It holds at most one action, such as Undo; the Inbox renders it right after its heading, so Undo is the next tab stop from where focus lands. It rises over 180ms and leaves over 120ms, and hides with opacity so its live region stays in the accessibility tree.
- **Navigation bar:** a 2px accent line along the top of the page during a slow navigation. It waits 150ms, so a fast one shows nothing, then creeps to 90% over 8 seconds on the entrance curve.

### Brand moments

- **Mark loader:** the mark in four diagonal bands that light in reading order. Brand at 28px leads the pull request page's generating card and its wait after a newer push; Text 2 at 14px sits in an inbox row's Generating, the Brief header's revision chip and the newer-commits chip. It is decorative: the status text beside it is what a screen reader hears. Every other loading state keeps its own mechanism: the URL box sweep, the sign-in spinner, the navigation bar, skeletons and busy buttons.
- **Ghost mark:** the mark in Surface 3 at 64px, in first-run empty states only: on Home with nothing to review it sits centred where the list would be, under the URL box; on a pull request with no brief, whether it waits on a Trigger or was never briefed, it leads the card.

### Motion

Durations 120, 180 and 320ms, one 700ms spinner period every spinner reads through `--motion-spin`, the mark loader's 1.4s pass (`--motion-read`) with its bands 140ms apart on the entrance curve, and a 350ms rest before a callout. Easing `cubic-bezier(0.23, 1, 0.32, 1)` for entrances and `cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement; a plain colour or opacity change may keep the `ease` keyword. Both pages read the same three duration tokens and two curves. A third curve, `--ease-drawer` (`cubic-bezier(0.32, 0.72, 0, 1)`), slides the Brief page's focus panel. The Brief header collapses over 180ms on the entrance curve with transforms alone and applies its new height once. The sidebar's panel pushes the reading column: both change width on one clock, 260ms in (`--motion-slide`) and 180ms out on the entrance curve, the one place a layout width animates. Hover and colour changes take 120ms. What enters takes 180ms and leaves over 120ms, so the dialog, the toast and the focus panel leave faster than they arrive. The focus panel's shortcuts strip is the exception: it opens and closes over 180ms, its width and its fade on one duration. Two durations are their own: the focus panel's 260ms slide (`--motion-slide`), which the focus column, the chunk footer and the sidebar's opening share, and the 1.4s conversation flash (`--motion-flash`). On first load rows fade up 6px with a 30ms stagger, capped at twelve rows. Page change, sort, filter and keyboard movement never animate.

**Reduced motion.** Movement goes and fades stay: only opacity, colour and shadow changes still transition. Rises and sheets fade in place, a press does not scale, a menu or callout appears at once, the navigation bar holds at 90%, spinners stop, and the mark loader pulses at half speed without moving.

## Do's and Don'ts

- Do lead the personal line with a fact only this product knows. Don't greet.
- Do let a repeated value disappear (status Open). Don't print a column that says one word.
- Do keep every page flat: no page light and no blur. Don't add a gradient to a surface.
- Do use amber for risk attributes, where the brief may be wrong, and the Amber Rule's listed exceptions. Don't use it for new commits, a count that is not a risk, or decoration.
- Do use the accent for what needs the reviewer. Don't use it for decoration or for state.
- Do keep the brand to the mark, the one primary action and the review progress bar. Don't use it for a state, a link or a highlight.
- Do give every new token a plan: where the Brief page adopts it and what it replaces.
- Don't add a card per row, a stat tile outside the verification receipt's three, an all-caps label, or monospace outside the Code Only Rule's list.
