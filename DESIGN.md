---
name: MergeBrief
description: A calm, dark reading surface for understanding a pull request before reviewing it.
colors:
  accent: "#e1e1e1"
  accent-ink: "#1b1b1b"
  ground: "#0a0a0c"
  surface-1: "#111114"
  surface-2: "#15151a"
  surface-3: "#1c1c22"
  text-1: "#ececee"
  text-read: "#cacad1"
  text-2: "#9a9aa3"
  text-3: "#8d8d94"
  line: "#1f1f24"
  line-strong: "#2b2b32"
  state-open: "#5fc88f"
  state-merged: "#a98fd1"
  state-closed: "#e06c6c"
  state-warning: "#d9a45c"
  concern-implementation: "#5f96dc"
  concern-test: "#b25c3e"
  concern-doc: "#3daa7e"
  concern-spec: "#b17921"
  concern-config: "#8f87d9"
  concern-generated: "#b05774"
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
    lineHeight: 1.25
  panel-title:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
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
    lineHeight: 1.55
  reading:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
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
  chip: "5px"
  md: "8px"
  panel: "10px"
  lg: "12px"
  pill: "999px"
  circle: "50%"
spacing:
  "1": "2px"
  "2": "4px"
  "3": "8px"
  "4": "12px"
  "5": "16px"
  "6": "24px"
  "7": "32px"
  "8": "48px"
  "9": "64px"
components:
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 16px"
  button-primary:
    backgroundColor: "{colors.text-1}"
    textColor: "{colors.accent-ink}"
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
    rounded: "{rounded.panel}"
    height: "44px"
  url-box-focus:
    backgroundColor: "{colors.surface-3}"
  list:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.panel}"
  list-row:
    height: "56px"
    padding: "9px 16px"
  list-row-hover:
    backgroundColor: "{colors.surface-2}"
  list-row-cursor:
    backgroundColor: "{colors.surface-3}"
  chip:
    textColor: "{colors.text-read}"
    rounded: "{rounded.chip}"
    height: "20px"
    padding: "0 7px"
  filter:
    rounded: "{rounded.md}"
    height: "28px"
  filter-changed:
    textColor: "{colors.accent}"
  menu:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.panel}"
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
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.circle}"
    size: "26px"
---

# Design System: MergeBrief

Status: built on Home, which leads this language; the Brief page follows it. The palette is the one the Brief page was designed on, expressed as tokens: hue 286, the greys at chroma 0.01 and the accent a white at chroma 0. The hex values above are what that renders today, and the source of truth is four numbers in `apps/web/src/styles/tokens.scss`. Nothing on screen carries the hue but the greys; the info blue (`--color-info`) keeps its lane.

## Overview

**Creative North Star: "The reading room"**

The product takes a pull request that is hard to read and makes it easy to read. The interface is the room you read it in at night: a dark page, text that is calm and large enough, and nothing blinking for attention. The room is lit by nothing but the type. The three words it aims for are calm, mine, ready.

Calm comes from neutral greys and one pale accent. Structure comes from hairlines, not from raised cards. Impressive means exact alignment, generous type and instant response, never decoration.

**Key Characteristics:**

- Dark only. A near-black page, flat from edge to edge; no glow, no page gradient and no backdrop blur, focus mode included.
- Hairline borders and row dividers. No card per row.
- One accent. It marks what needs the reviewer, the primary action, and focus.
- Two-line rows of 56 to 57px. Titles at 15px; the smallest text is 11px.
- Motion is rare and short. Keyboard movement never animates.

Never: a dashboard of stat tiles, a greeting, all-caps labels, monospace used as decoration, a badge on everything.

## Colors

Neutral greys under one light accent. State colours keep a fixed meaning across the product.

### Primary

- **Accent** (#e1e1e1, the `--brand-400` primitive, a white at 91% lightness and chroma 0): review marks for rows that need the reviewer, the Generate button, focus rings, the selected diff rows, the revision marks, the value of a changed filter, the current page. Dark text on it uses **Accent Ink** (#1b1b1b, derived at 22% lightness).

### Neutral

- **Ground** (#0a0a0c): the page. Focus mode drops to a darker **Focus Ground** at 11.5% lightness, one flat fill.
- **Scrim** (black at 55%): behind dialogs and sheets.
- **Surface 1, 2, 3** (#111114, #15151a, #1c1c22): the list, then hover and the URL box, then menus, the keyboard cursor row and the focused URL box.
- **Well** (Ground 25% into Surface 1): the diff's code and a chunk's head, the one surface a step below the card it sits in.
- **Text 1** (#ececee): titles that need the reviewer (new, updated since your review, in progress), headings.
- **Text Read** (#cacad1): titles that do not (reviewed, or the viewer's own), chip text.
- **Text 2** (#9a9aa3): the second line of a row, labels, quiet icons.
- **Text 3** (#8d8d94): placeholder text and unreachable rows. The floor for readable text, set so it clears 5:1 on Surface 3.
- **Line, Line Strong** (#1f1f24, #2b2b32): row dividers and the list edge, then control borders.

### State (fixed meaning, hue may be tuned)

- **Open** (#5fc88f), **Merged** (#a98fd1), **Closed and failed** (#e06c6c), **Warning** (#d9a45c). Draft is Text 2 with its own icon shape.

### Concern (marks only)

- **Implementation** (#5f96dc), **Test** (#b25c3e), **Doc** (#3daa7e), **Spec** (#b17921), **Config** (#8f87d9), **Generated** (#b05774), and **Unattributed** (#7c7c87), the one neutral. Every hue sits at OKLCH chroma 0.12, and neighbours in that order step lightness so adjacent segments stay apart under colour-vision deficiency. A concern colour draws a dot or a split segment, never a word or a fill.

### Named Rules

**The Light Accent Rule.** The accent is always light: it is used as a fill under dark text and as small marks on a dark page. It reads as a light, not a paint: high lightness and low chroma, a white with a hue rather than a saturated colour. A dark or heavily saturated brand colour needs a lighter partner for the interface. Today the chroma is 0: the accent is a white at 91% lightness and carries its meaning by lightness alone.

**The One Hue Rule.** The theme is four numbers in `tokens.scss`: `--brand-hue`, the accent's `--accent-l` and `--accent-c`, and the greys' `--gray-c`. The accent and every grey derive from the hue in OKLCH at fixed lightness steps, so changing the hue moves the whole palette together and every contrast holds. Nothing else in the app states the hue.

**The Four Lanes Rule.** Green, violet, red and amber belong to states. A brand hue inside one of them reads as a state. The free lanes are blue to cyan, pink to magenta, and orange to peach. The concern marks are the one exception: Doc, Spec and Test share hues with Open, Warning and Closed and stay apart from them only by sitting darker, and Config sits beside Merged in the violet lane at nearly its lightness. Context carries the rest: a concern mark always sits beside its concern's name, and a state colour never does.

**The Tinted Grey Rule.** Greys carry the hue at one very low chroma, `--gray-c`, 0.01 at hue 286; the ghost separator doubles it and Text 1 takes a third, so the brightest grey stays within two steps of neutral on every channel. When the brand hue changes, the greys move with it, at the same lightness, so contrast holds; a hue whose tint reads too strong on the greys turns `--gray-c` down, and 0 makes every grey neutral without touching the accent. In OKLCH lightness: ground 0.146, surfaces 0.179, 0.198 and 0.229, lines 0.241 and 0.292, the ghost separator 0.355, text 0.944, 0.84, 0.689 and 0.645, accent 0.91 at chroma 0. Surface 3 sits below Line on purpose: a menu's fill is darker than the hairline that edges it.

**Contrast.** Text is 5:1 or better on every surface it sits on, and 5.5:1 or better on the page and the list; icons and state marks 3:1 or better. The palette contrast test in `apps/web/src/styles` holds those lines against the tokens; a pair below its line fails the test suite. Two deliberate exceptions: the URL box edge at rest is about 1.4:1, and the link icon, the placeholder and the slash key mark the field instead; a selected diff row lifts the well by 14% of the accent, its number cells by 24%; code and syntax colours read against the row at the AA line, 4.5:1 or better, and the numbers take Text 1 against the number cells, which the same test holds. Focus always shows a 2px accent ring.

## Typography

**Display and Body Font:** IBM Plex Sans (with -apple-system, Helvetica Neue, sans-serif)
**Code Font:** IBM Plex Mono, for code and what identifies code

Both are self-hosted through `@fontsource`, every subset behind its `unicode-range` so a Latin page downloads Latin alone and a Cyrillic line still sets in Plex (Plex Mono ships no Greek); sans and mono each at 400, 500 and 600. The two body files (sans 400, mono 400) are preloaded from the root route so the fallback never flashes; no font loads from a third-party origin.

**Character:** One family at every size. Hierarchy comes from size, weight and the step from Text 1 to Text 2, not from a second typeface. The scale is seven steps: 11, 13, 15, 17, 20, 24 and 30px, stated in rem so it follows the reader's browser font size. Weights are 400, 500 and 600; nothing else loads. Two token names run against the step names: Caption is `--font-size-sm` and Small is `--font-size-lg`, because `--font-size-md` was the retired 12px step between them and is not reused.

The root stays at the browser's size, 16px by default. Only `body` is fluid: a clamp of 14 to 15px on `round(0.8rem + 0.2vw, 0.25px)`, which lands on quarter pixels (14.25 at 750 wide, 14.75 at 1000). That off-scale value is deliberate, and it reaches only text that inherits and names no step. Text fields take one more off-scale size on a touch screen, 16px, because iOS Safari zooms into a field set smaller.

### Hierarchy

- **Display** (600, 1.875rem, 1.1, -0.02em): the personal line on Home and the Settings heading. One per screen. Under 760px it steps down to 24px.
- **Headline** (600, 1.5rem, 1.2): the Brief's title at rest and the sign-in heading. The Brief's title collapses to 13px once the page scrolls; on a phone it is 20px in the page and 13px in the row.
- **Group title** (600, 1.25rem): a change group's name in its card.
- **Panel title** (600, 1.0625rem, 1.3): dialog titles and Settings panel headings.
- **Title** (600, 0.9375rem, 1.2): section headings such as the list heading.
- **Row title** (500, Text 1 when it needs the reviewer and Text Read otherwise, whatever the layout, 0.9375rem, 20px line): one line, cut with an ellipsis.
- **Lead** (400, 1.0625rem, 1.5): the line under the personal line and the Instance tab's count, 62 characters wide at most. The sign-in lead sits a step down at 15px.
- **Reading** (400, 0.9375rem, 1.65, Text Read): the words of a brief, its overview, changelog and summaries.
- **Small** (400 to 600, 0.8125rem): controls, menus, the pager, code, the second line of a row with an 18px line and tabular numerals, the chunk and focus indicators with tabular numerals, and the URL box's slash hint. Running text sets at 400; chips, the chunk indicator and the focus indicator's label and current count at 500; titles and figures inside a panel at 600; buttons at 400 to 600. The shortcuts dialog's section headings take the Title step.
- **Caption** (400, 500 or 600, 0.6875rem): the Brief page's badges and meta rows, a group's category chips, the generation warnings chip, the change stepper's count outside the Brief controls sheet, small section labels and every other key cap. Nothing smaller ships.

### Named Rules

**The No Shouting Rule.** No all-caps labels and no letter-spaced small caps anywhere.

**The Code Only Rule.** Monospace appears only for code and what identifies code. The whole list: inline code and code blocks, diffs with their line numbers, file paths, commit hashes, branch names, model ids with the effort beside them, and key caps. Everything else is the sans, and a count sets in the sans with tabular numerals: header stats, added and deleted lines, positions like Group 1 of 3, labels, chips and headings.

**The Amber Rule.** Amber means look here or this brief may be wrong, nothing else: risk attributes (the chips, the Risk attributes count and the group card's risk notes), generation warnings, repo-config trouble, a group's Uncertain classification chip, and the Submit dialog's warning that the pull request has newer commits. A de-emphasised risk attribute drops to neutral. Its deliberate exceptions are cautions someone must act on: the Settings spend meter near or at its cap and the capped note, the version notice, a primary ticket that could not be read and the diff-timeout notice. A misaligned ticket read stays neutral. A Home row's New commits chip is not a warning: new commits are a change to read, so it takes the changed tint. The Brief's own Newer commits control takes the changed tint. "Not an approval" is neutral text.

## Layout

One centred column, 1080px wide at most, with a 24px gutter that becomes 16px under 760px; the header shares the gutter, so its wordmark and account trigger line up with the column. The Header is one 52px tier, transparent, with a Line hairline under it. Its right end is the account trigger: a pill holding the avatar, concentric in the pill's cap, and a caret; its menu offers Settings, a Language group where language selection is enabled, Keyboard shortcuts (not on touch) and Sign out.

Spacing uses one scale: 2, 4, 8, 12, 16, 24, 32, 48, 64. Blocks are grouped, not evenly spaced: the personal line and the URL box sit 16px apart as one group; the list begins 48px below them; a heading sits 12px above its list. There is always more space above a heading than below it.

The list splits at a fold. Rows that need the reviewer (open, not a draft, and new, updated since your review or in progress) come first; a quiet line reading "Not waiting on you" follows; reviewed rows, drafts, merged or closed rows and the viewer's own come last. The personal line above counts the rows the fold lifts ("5 pull requests need your attention") and lists their states, what changed since your review first; with nothing waiting it reads "You are all caught up". Each group keeps the chosen sort. A View control beside Sort offers the other layout, "Mixed": one list in the sort's order with no fold. The choice rides the URL and is not a filter, so Clear leaves it.

Under 760px the filters collapse behind one button and the controls take their own line; under 400px View and Sort may wrap under the Filters button. Status labels become icons with hidden text. The page never scrolls sideways down to 320px.

**Sign-in.** A signed-out viewer of any page gets one centred column, 360px wide at most, with no header: the 28px mark, a Headline, a 15px lead, a full-width 44px accent button and one quiet note.

**Settings.** Home's shell: the same Header, gutter and column, with the heading in Display and the panel 32px below it (24px under 760px). A viewer with one tab gets no rail. An Operator gets a 184px rail beside the panel, 48px apart and pinned 24px from the top, where the current tab takes Surface 3 on an 8px corner. On a phone the rail becomes a row of tabs over a hairline.

**Brief page.** Above phone width the header keeps two tiers, solid on the ground. At 1120px and under the sidebar becomes a bar along the bottom that opens its lists in a bottom sheet.

**Phone reader.** A phone is 880px wide or less, or sideways: `(orientation: landscape) and (height <= 500px) and (width <= 1120px) and (pointer: coarse)`. Height keys the sideways case because a large phone lands past the width line, the coarse pointer keeps a short desktop window out, and the orientation keeps a split-screen portrait pane upright. Upright, three bars frame the reading, 44 + 56 + 56: a 44px row with back and the wordmark, then the title once the page title has scrolled away; a chunk's 56px two-line head pinned under it, with the path over its counts and Viewed; a 56px bar at the bottom edge with Brief controls, the chunk indicator that opens the Sidebar sheet, and previous and next, which Changes leaves out because its chunks are not on the page. Sideways, all of it folds into one 44px row, and a chunk's head parks behind the row, which names the chunk from then on; a fold or Viewed from the row that collapses the chunk parks its head there too. Focus mode has no row, so its head stays pinned. Controls in these bars are 44px targets. The bottom bar pads for the home indicator and the sideways row for the notch, both from safe-area insets.

## Elevation & Depth

Flat, with tonal layering. Surfaces step up in brightness; hairlines draw the edges. Shadows appear only on things that float or that invite input. Everything that sits over content is solid, sticky bars and focus mode's floating pieces included, so code never shows through a control. No backdrop blur ships.

**The Mechanism Gradient Rule.** A gradient never colours a surface. It survives only as a mechanism: the URL box's submit sweep, the scroll-edge shadows on the Sidebar's lists and a group card's file list, skeleton shimmer, a changed line's wash in a compared diff, the hatch on an empty split cell and a media placeholder, the fade at the foot of a clamped comment, and the mask at the media strip's edge.

### Shadow Vocabulary

- **URL box at rest** (`inset 0 0 0 1px` of Text 1 at 9%, plus `0 14px 32px -16px rgb(0 0 0 / 60%)`): a faint edge and a soft lift.
- **URL box focused** (the same edge, plus `0 0 0 2px` of the accent at 50% and `0 18px 40px -16px` of the accent at 16%).
- **What floats** (`0 18px 44px -10px rgb(0 0 0 / 70%)`): menus, callouts, and focus mode's pill and panel.
- **Toasts and sheets** (`0 16px 48px rgb(0 0 0 / 55%)`).

A dialog takes no shadow; the scrim separates it.

## Shapes

Small, consistent corners: 4px for key caps, 5px for chips, 8px for controls and toasts, 10px for the list, the URL box, menus and callouts, 12px for dialogs and a sheet's top corners. Six tokens carry them: `--radius-xs` (2px, a sliver for bars and markers), `--radius-sm` (4px), `--radius-chip` (5px), `--radius-md` (8px), `--radius-panel` (10px) and `--radius-lg` (12px). Four are named by size and two by the role that wears the odd value, so a chip and a panel never borrow a neighbour's step. Round is kept for people, on two more tokens: the avatar is a circle (`--radius-circle`, 50%) and the account trigger a pill (`--radius-pill`, 999px). The pill has two more uses. A status pill that rides inside a line of text or a diff takes it: the read-only chip, a revision tag, the warming chip, a thread count, a conversation chip and a Changes-only group's category, as do focus mode's pill and tab and the details `i`. So do marks with no corner to speak of: a spinner, a progress fill, a scrollbar thumb, a status dot and the sheet's grip. Borders are 1px. Chips are filled with a soft tint and have no border. Review marks are drawings from the icon set on its 16px grid: a filled circle (new), a filled half circle (in progress), a ringed dot (updated since your review), a ringed check (reviewed).

## Icons

One family, Phosphor, copied icon by icon into `apps/web/src/components/icons/<phosphor-name>.svg`; no dependency, and no second folder. The file name is Phosphor's name; the meaning lives at the site, not in the file.

- **Grid and weight.** A 16px grid at the Bold weight, which is a 1.5px stroke at 16px; the stroke scales with the box, about 1.3px at 14 and 1.1px at 12.
- **Three sizes.** 12 inside a chip, 14 inside a control (icon button, toolbar, pager, menu row), 16 in a row or a state. Nothing else without a stated reason.
- **Colour.** `currentColor`, set by the site's token.
- **Fill.** Stroke by default. Fill is the "on" form of the same icon (selected, active, checked), plus the icons whose meaning is the fill: the four review marks.
- **Direction by rotation.** One `caret-down` for every caret and disclosure, one `arrow-up` for every arrow, turned in quarter steps by CSS. No mirrored files.
- **The `Icon` component** owns the contract: `name` from the set, `size` (12, 14, 16), `color`, `rotation`, `className` and an optional `label`. Without a label it is decorative, `aria-hidden` with `focusable="false"`, and the control or row around it carries the meaning; with one it takes `role="img"`. An override is a visible prop, never a second file.
- **Brand glyphs** (GitHub, the provider marks) ride the same component and props; their own viewBox and fill are the only difference. A full logo, and the product's own mark, sit outside the set.
- **Text glyphs** are typography, not icons: `↳`, `▪`, `×` and `·` stay text, and the spinner stays CSS. Every other glyph is an svg from the set.

## Components

One skin on both pages: corner, edge, fill and the hover, pressed and selected tints are shared; each page keeps its own sizes, padding and type.

### Buttons

- **Shape:** 8px corner. Every variant takes its height from padding and the body line-height, about 38px, so a confirm and its Cancel sit level; the URL box sizes its own Generate at 32px inside the field.
- **Accent:** accent fill, Accent Ink text: the primary action of a view, Generate on Home, Submit and the dialogs' confirm on the Brief page. One per view. Hover mixes 15% of the page ground into the fill, press 25%: the accent is a light, so its pressed state is a shade darker.
- **Secondary:** transparent with a Line Strong border.
- **Danger:** Closed red fill under Accent Ink; hover mixes 10% of the page ground into the fill, press 18%. An outline variant keeps only the red edge and text.
- **Disabled:** a Line edge and Text 2, with no fill. The accent keeps a Surface 2 fill with Text 3, so a disabled primary is never the brightest thing in a dialog.
- **Icon buttons:** borderless, Text 2, Surface 3 under the pointer with Text 1. The triggers that need a visible edge (the account trigger's pill, the details trigger's ring) draw their own.
- **Press:** a Button or icon button scales to 0.97 over 120ms on the entrance curve; a toolbar button never scales, it can be a full-width heading, so it takes a background step instead, as rows and tabs do. No hover movement anywhere.

**The Hover Rule.** Every hover style sits behind `(hover: hover)`, so a tap never leaves one stuck. A control that hover reveals on a pointer has a touch route: visible at rest, or behind an explicit mode or menu, as a row's actions and checkbox are.

### URL box

- **Style:** Surface 2 fill, faint edge, soft shadow, 10px corner, 44px tall. A link icon leads; the slash key hint sits at the end and gives way to the Generate button once text is entered.
- **Focus:** Surface 3 fill, 2px accent ring, accent-cast shadow. The icon turns accent.
- **Submitting:** the field is replaced by one line of status and a thin accent sweep along the bottom edge.

### List and rows

- **Container:** Surface 1, 1px Line edge, 10px corner, Line dividers between rows. No card per row.
- **Row:** two lines, 56px for the first row of a list and 57px after it, where the divider adds one. Line one is the mark, the title and chips. Line two is another author's chip when the row is someone else's, the source icon (URL pull requests only), repository, number and age, in Label type, on one baseline. Inline code in a title takes a chip. A code chip wider than the row is cut inside itself; a chip that follows words and doesn't fit is replaced whole by the title's ellipsis.
- **Right edge:** generation state (generating, queued, failed) and the status, right-aligned and flush. Status is printed only when it is not Open.
- **Hover:** Surface 2. Actions fade in over the right edge (opacity only, 120ms): Open on GitHub, and a menu with Copy link, Open on GitHub, Archive, Delete on the viewer's own URL rows and on installation rows in repositories the viewer administers, Delete attachment branch on those installation rows, and Regenerate leading it when a pasted row is behind, unless its last generation failed in a way a repeat paste fails again. On touch only the menu stays visible, so a phone row keeps its width for the title and repository.
- **Selecting:** a pointer reserves a checkbox column and shows the box on hover or focus, so a reveal moves nothing. Touch gives the column no width until Select is pressed. A selection row sits under the filters on its own line, so the filters stay in view while rows are ticked: at rest it holds the total ("11 briefs", or "Showing 10 of 24 briefs" past one page), plus Select on touch, with the page checkbox hidden in its column like a row's box; once selecting, the page checkbox and every row's box show and the row takes a surface with the count, Archive, Delete and Clear selection.
- **Keyboard cursor:** Surface 3 plus a 1px inset accent ring at 55%. It appears and moves with no animation. On the Brief page the current chunk wears the same ring on its own edge, over Surface 1.
- **Accessible name:** the row link reads the review state, status, generation state and source in words before the title. The mark sits inside the link with a hover callout naming its state; icons are hidden from assistive technology.

### Chips

- **Style:** 5px corner (a status pill takes the pill, see Shapes), soft tint (Text 1 at 7%), no border, the sans at 500 in Text Read. A fact chip is 20px tall and states one thing about a row: place in a stack, new commits (in the changed tint), unreachable. A filter chip keeps the Brief page's 26px and its check glyph.
- **States:** a pressed chip takes the changed tint, accent at 8% behind a 45% accent edge, with accent text; a warning chip sits on a 12% warning tint in Warning.
- **Badge:** the chip corner on a 12% tint of its colour, weight 500, no border, and the words in their own case. The Brief header is the exception: its status and stack chips sit on the page ground with no list around them, so each keeps an edge, the status chip in its own colour at 35% and the neutral stack chip in Line Strong. A risk badge from repo policy alone draws a dashed edge in its colour, and a de-emphasized one a dotted edge.

### Filters, sort and pager

- **Filter:** 28px, 8px corner, Line Strong border, Text 1, Surface 2 under the pointer. It shows its name only; a value appears when it is set, and several values show as a count. A changed filter takes the changed tint and an accent value. Every multi-select filter opens with an "All …" row, ticked while nothing narrower is chosen; Status's ticks all four statuses. Author, List and Installation fold under More filters. Clear sits beside View and Sort.
- **Toolbar buttons and the segmented control** on the Brief page wear the filter's skin: the same edge and corner, the changed tint when pressed or active; the active segment adds a 1px inset accent edge. A mixed state keeps a dashed edge so it never rests on colour alone.
- **Review filter:** lists each review mark beside its name and doubles as the legend.
- **View:** Needs you first (the fold) or Mixed (one list). Named like a filter: its value shows once changed.
- **Pager:** numbered, 30px bordered squares; the current page takes the accent tint. The range reads "1 to 25 of 290".

### Menus and callouts

- **Menu:** Surface 3, Line Strong border, 10px corner, the float shadow. Opens from its trigger's corner: opacity and scale from 0.97 over 180ms, ease-out. Items are Text 1 with Line Strong at 40% under the pointer. A menu that stays open while its content changes does not replay its entrance. On a phone the Brief's Filter and Risk attributes panels, which open inside Brief controls, rise as a sheet of their own instead, with no handle: up to 70% of the viewport upright, the space under the row sideways. Under 760px Home's filters open on the Bottom sheet.
- **Callout:** the menu's surface, edge, corner and shadow. Opens after a 350ms pointer rest, or at once on keyboard focus where the anchor is focusable; a touch never opens it by hover. It enters like a menu, opacity and scale from 0.97 over 180ms, and takes no space when hidden. Within 600ms of one leaving, the next opens with no delay and no entrance. The SegmentedControl's own instant tip on the Brief page has not moved onto it yet.
- **Dialog:** Surface 3 behind a Line Strong edge, 12px corner, 24px padding, 460px wide or up to 640 where it holds a list, over the scrim. One header and one footer: the Panel title with an optional 13px detail and a close button at its end, then right-aligned actions with Cancel before the primary. The box scrolls and the footer pins to its bottom edge, so the actions stay reachable on a sideways phone. The verification receipt is the exception: its header and footer hold still and only the receipt's folds scroll between them. The scrim fades over 160ms and the box takes opacity and scale from 0.98 over 180ms on the entrance curve; both leave over 120ms. The box itself never shows a focus ring; a dialog with one obvious first control (the dismiss reason field) focuses it on open, any other lands on the box.

### Bottom sheet

The one sheet on narrow screens. It holds the Sidebar sheet, Brief controls, a chunk's menu and, under 760px, Home's filters: every filter in one list, grouped under its name, that stays open across choices.

- **Style:** Surface 1 under a Line Strong top edge, 12px top corners, the sheet shadow, over the scrim, and always above the phone bar and the narrow sidebar bar.
- **Height:** half the viewport, with a 40 by 4px grip in a 72 by 24px handle that grows it to the space under the pinned stack; on Home, with no pinned stack, it grows to the full viewport. Sideways it opens at that full height, with no handle.
- **Motion:** it rises over 320ms on the entrance curve while the scrim fades over 180ms; the height change takes 180ms on the on-screen curve.

### Toast and navigation bar

- **Toast:** Surface 3, Line Strong edge, 8px corner, the sheet shadow, Small at 500 in Text 1, 28px above the bottom and above any bar, 560px wide at most. It holds at most one action, such as Undo; the Inbox renders it right after its heading, so Undo is the next tab stop from where focus lands. It rises over 240ms and leaves over 160ms, and hides with opacity so its live region stays in the accessibility tree.
- **Navigation bar:** a 2px accent line along the top of the page during a slow navigation. It waits 150ms, so a fast one shows nothing, then creeps to 90% over 8 seconds on the entrance curve.

### Motion

Durations 120, 180 and 320ms, one 700ms spinner period every spinner reads through `--motion-spin`, the shared Callout's 140ms entrance, and a 350ms rest before a callout. Easing `cubic-bezier(0.23, 1, 0.32, 1)` for entrances and `cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement; a plain colour or opacity change may keep the `ease` keyword. Both pages read the same three duration tokens and two curves. A third curve, `--ease-drawer` (`cubic-bezier(0.32, 0.72, 0, 1)`), slides the Brief page's focus panel. The Brief header collapses over 160ms on the entrance curve with transforms alone and applies its new height once. The sidebar slides its panel on the same curve and changes the column once. Some surfaces state their own durations on purpose: the dialog's 160ms scrim, the toast's 240 and 160ms, the focus panel's 220 and 260ms, the story step's 260ms, the 1.4s conversation flash. On first load rows fade up 6px with a 30ms stagger, capped at twelve rows. Page change, sort, filter and keyboard movement never animate.

**Reduced motion.** Movement goes and fades stay: only opacity, colour and shadow changes still transition. Rises and sheets fade in place, a press does not scale, a menu or callout appears at once, the navigation bar holds at 90%, and spinners stop.

## Do's and Don'ts

- Do lead the personal line with a fact only this product knows. Don't greet.
- Do let a repeated value disappear (status Open). Don't print a column that says one word.
- Do keep every page flat: no page light and no blur. Don't add a gradient to a surface.
- Do use amber for risk attributes, where the brief may be wrong, and the Amber Rule's listed exceptions. Don't use it for new commits, a count that is not a risk, or decoration.
- Do use the accent for what needs the reviewer. Don't use it for decoration or for state.
- Do give every new token a plan: where the Brief page adopts it and what it replaces.
- Don't add a card per row, a stat tile, an all-caps label, or monospace outside the Code Only Rule's list.
