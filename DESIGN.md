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
typography:
  display:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
  code:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.88em"
    fontWeight: 400
rounded:
  xs: "2px"
  sm: "4px"
  chip: "5px"
  md: "8px"
  panel: "10px"
  lg: "12px"
  pill: "999px"
  round: "50%"
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
  avatar:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.round}"
    size: "26px"
---

# Design System: MergeBrief

Status: built on Home, which leads this language; the Brief page follows it. The palette is the one the Brief page was designed on, expressed as tokens: hue 286, the greys at chroma 0.01 and the accent a white at chroma 0. The hex values above are what that renders today, and the source of truth is four numbers in `apps/web/src/styles/tokens.scss`. Nothing on screen carries the hue but the greys; the info blue (`--color-info`) keeps its lane.

## Overview

**Creative North Star: "The reading room"**

The product takes a pull request that is hard to read and makes it easy to read. The interface is the room you read it in at night: a dark page, text that is calm and large enough, and nothing blinking for attention. The room is lit by nothing but the type. The three words it aims for are calm, mine, ready.

Calm comes from neutral greys and one pale accent. Structure comes from hairlines, not from raised cards. Impressive means exact alignment, generous type and instant response, never decoration.

**Key Characteristics:**

- Dark only. A near-black page, flat from edge to edge; no glow and no gradient on either page.
- Hairline borders and row dividers. No card per row.
- One accent. It marks what needs the reviewer, the primary action, and focus.
- Two-line rows of 56px. Titles at 15px; the smallest text is 11px.
- Motion is rare and short. Keyboard movement never animates.

Never: a dashboard of stat tiles, a greeting, all-caps labels, monospace used as decoration, a badge on everything.

## Colors

Neutral greys under one light accent. State colours keep a fixed meaning across the product.

### Primary

- **Accent** (#e1e1e1, the `--brand-400` primitive, a white at 91% lightness and chroma 0): review marks for rows that need the reviewer, the Generate button, focus rings, the selected diff rows, the revision marks, the value of a changed filter, the current page. Dark text on it uses **Accent Ink** (#1b1b1b, derived at 22% lightness).

### Neutral

- **Ground** (#0a0a0c): the page.
- **Surface 1, 2, 3** (#111114, #15151a, #1c1c22): the list, then hover and the URL box, then menus, the keyboard cursor row and the focused URL box.
- **Text 1** (#ececee): titles that need the reviewer (new, updated since your review, in progress), headings.
- **Text Read** (#cacad1): titles that do not (reviewed, or the viewer's own), chip text.
- **Text 2** (#9a9aa3): the second line of a row, labels, quiet icons.
- **Text 3** (#8d8d94): placeholder text and unreachable rows. The floor for readable text, lifted from the hold's #8a8a93 so it clears 5:1 on Surface 3.
- **Line, Line Strong** (#1f1f24, #2b2b32): row dividers and the list edge, then control borders.

### State (fixed meaning, hue may be tuned)

- **Open** (#5fc88f), **Merged** (#a98fd1), **Closed and failed** (#e06c6c), **Warning** (#d9a45c). Draft is Text 2 with its own icon shape.

### Named Rules

**The Light Accent Rule.** The accent is always light: it is used as a fill under dark text and as small marks on a dark page. It reads as a light, not a paint: high lightness and low chroma, a white with a hue rather than a saturated colour. A dark or heavily saturated brand colour needs a lighter partner for the interface. Today the chroma is 0: the accent is a white at 91% lightness and carries its meaning by lightness alone.

**The One Hue Rule.** The theme is four numbers in `tokens.scss`: `--brand-hue`, the accent's `--accent-l` and `--accent-c`, and the greys' `--gray-c`. The accent and every grey derive from the hue in OKLCH at fixed lightness steps, so changing the hue moves the whole palette together and every contrast holds. Nothing else in the app states the hue.

**The Four Lanes Rule.** Green, violet, red and amber belong to states. A brand hue inside one of them reads as a state. The free lanes are blue to cyan, pink to magenta, and orange to peach.

**The Tinted Grey Rule.** Greys carry the hue at one very low chroma, `--gray-c`, 0.01 at hue 286; the ghost separator doubles it and Text 1 takes a third, so the brightest grey stays within two steps of neutral on every channel. When the brand hue changes, the greys move with it, at the same lightness, so contrast holds; a hue whose tint reads too strong on the greys turns `--gray-c` down, and 0 makes every grey neutral without touching the accent. In OKLCH lightness: ground 0.146, surfaces 0.179, 0.198 and 0.229, lines 0.241 and 0.292, the ghost separator 0.355, text 0.944, 0.84, 0.689 and 0.645, accent 0.91 at chroma 0. Surface 3 sits below Line on purpose: a menu's fill is darker than the hairline that edges it.

**Contrast.** Text is 5:1 or better on every surface it sits on, and 5.5:1 or better on the page and the list; icons and state marks 3:1 or better. The palette contrast test in `apps/web/src/styles` holds those lines against the tokens; a pair below its line fails the test suite. On the Brief page words may be 12px. Two deliberate exceptions: the URL box edge at rest is about 1.4:1, and the link icon, the placeholder and the slash key mark the field instead; a selected diff row lifts the well by a tenth of the accent, and its gutter numbers read against that at the AA line, 4.5:1 or better, which the same test holds. Focus always shows a 2px accent ring.

## Typography

**Display and Body Font:** IBM Plex Sans (with -apple-system, Helvetica Neue, sans-serif)
**Code Font:** IBM Plex Mono, for code and commit hashes only

Both are self-hosted through `@fontsource`, every subset behind its `unicode-range` so a Latin page downloads Latin alone and a Cyrillic line still sets in Plex (Plex Mono ships no Greek); sans at 400, 500, 600 and 700 and mono at 400, 500 and 600. The two body files (sans 400, mono 400) are preloaded from the root route so the fallback never flashes; no font loads from a third-party origin.

**Character:** One family at every size. Hierarchy comes from size, weight and the step from Text 1 to Text 2, not from a second typeface. The scale is 10, 11, 12, 13, 15, 17, 20, 24 and 30px.

### Hierarchy

- **Display** (600, 1.875rem, 1.1, -0.02em): the personal line on Home. One per screen. The signed-out hero steps up to a clamp of 32 to 48px, off the scale on purpose.
- **Title** (600, 0.9375rem, 1.2): section headings such as the list heading.
- **Row title** (500, Text 1 when it needs the reviewer and Text Read otherwise, whatever the layout, 0.9375rem, 20px line): one line, cut with an ellipsis.
- **Body** (400, 1.0625rem, 1.5): the line under the personal line and the signed-out copy, 62 characters wide at most.
- **Small** (400, 0.8125rem): controls, menus, the pager, and, with an 18px line and tabular numerals, the second line of a row and indicators; a fact chip takes 500. The shortcuts dialog's section headings take the Title step.

### Named Rules

**The No Shouting Rule.** No all-caps labels and no letter-spaced small caps anywhere.

**The Code Only Rule.** Monospace appears only for code and keys: inline code in a title, commit hashes, diffs, and the key caps of the shortcuts dialog.

## Layout

One centred column, 1080px wide at most, with a 24px gutter that becomes 16px under 760px; the header shares the gutter, so its wordmark and account trigger line up with the column. The Header is one 52px tier, transparent, with a Line hairline under it. Its right end is the account trigger: a pill holding the avatar, concentric in the pill's cap, and a caret; its menu offers Settings, Keyboard shortcuts and Sign out.

Spacing uses one scale: 2, 4, 8, 12, 16, 24, 32, 48, 64. Blocks are grouped, not evenly spaced: the personal line and the URL box sit 16px apart as one group; the list begins 48px below them; a heading sits 12px above its list. There is always more space above a heading than below it.

The list splits at a fold. Rows that need the reviewer (open, not a draft, and new, updated since your review or in progress) come first; a quiet line reading "Not waiting on you" follows; reviewed rows, drafts, merged or closed rows and the viewer's own come last. The personal line above counts the rows the fold lifts ("5 pull requests need your attention") and lists their states, what changed since your review first; with nothing waiting it reads "You are all caught up". Each group keeps the chosen sort. A View control beside Sort offers the other layout, "Mixed": one list in the sort's order with no fold. The choice rides the URL and is not a filter, so Clear leaves it.

Under 760px the filters collapse behind one button and the controls take their own line; under 400px View and Sort may wrap under the Filters button. Status labels become icons with hidden text. The page never scrolls sideways down to 320px.

## Elevation & Depth

Flat, with tonal layering. Surfaces step up in brightness; hairlines draw the edges. Shadows appear only on things that float or that invite input.

### Shadow Vocabulary

- **URL box at rest** (`inset 0 0 0 1px` of Text 1 at 9%, plus `0 14px 32px -16px rgb(0 0 0 / 60%)`): a faint edge and a soft lift.
- **URL box focused** (the same edge, plus `0 0 0 2px` of the accent at 50% and `0 18px 40px -16px` of the accent at 16%).
- **Menus and callouts** (`0 18px 44px -10px rgb(0 0 0 / 70%)`).

## Shapes

Small, consistent corners: 4px for key caps and callouts, 5px for chips, 8px for controls, 10px for the list, the URL box and menus, 12px for the shortcuts dialog. Six tokens carry them: `--radius-xs` (2px, a sliver for bars and markers), `--radius-sm` (4px), `--radius-chip` (5px), `--radius-md` (8px), `--radius-panel` (10px) and `--radius-lg` (12px). Four are named by size and two by the role that wears the odd value, so a chip and a panel never borrow a neighbour's step. Round is kept for people: the avatar is a circle and the account trigger a pill. Borders are 1px. Chips are filled with a soft tint and have no border. Review marks are authored glyphs on a 14px grid with a 1.5px stroke: a filled dot (new), a half disc (in progress), a ringed dot (updated since your review), a ringed check (reviewed).

## Components

### Buttons

- **Shape:** 8px corner. The accent variant is 32px tall; the neutral variants take their height from padding and the body line-height, about 38px.
- **Accent:** accent fill, Accent Ink text: the Generate button. One per view.
- **Primary:** Text 1 fill with dark text: Sign in with GitHub on the signed-out Home, where it stands 44px tall as the first screen's one target.
- **Secondary:** transparent with a Line Strong border.
- **Press:** a filter trigger scales to 0.97 over 120ms. No hover movement anywhere.

### URL box

- **Style:** Surface 2 fill, faint edge, soft shadow, 10px corner, 44px tall. A link icon leads; the slash key hint sits at the end and gives way to the Generate button once text is entered.
- **Focus:** Surface 3 fill, 2px accent ring, accent-cast shadow. The icon turns accent.
- **Submitting:** the field is replaced by one line of status and a thin accent sweep along the bottom edge.

### List and rows

- **Container:** Surface 1, 1px Line edge, 10px corner, Line dividers between rows. No card per row.
- **Row:** 56px, two lines. Line one is the mark, the title and chips. Line two is the source icon (URL pull requests only), repository, number and age, in Label type.
- **Right edge:** generation state (generating, queued, failed) and the status, right-aligned and flush. Status is printed only when it is not Open.
- **Hover:** Surface 2. Actions fade in over the right edge (opacity only, 120ms): Open on GitHub, and a menu with Copy link, Delete on the viewer's own URL rows, and Regenerate leading it when the row is behind.
- **Keyboard cursor:** Surface 3 plus a 1px inset accent ring at 55%. It appears and moves with no animation.
- **Accessible name:** the row link reads the review state, status, generation state and source in words before the title. The mark sits inside the link with a hover callout naming its state; icons are hidden from assistive technology.

### Chips

- **Style:** 20px tall, 5px corner, soft tint (Text 1 at 7%), no border, Text Read at 500. A chip states a fact about a row: place in a stack, new commits (in Warning), unreachable.

### Filters, sort and pager

- **Filter:** 28px, 8px corner, Line Strong border. It shows its name only; a value appears when it is set, and several values show as a count. A changed filter takes an accent tint and an accent value. Every multi-select filter opens with an "All …" row, ticked while nothing narrower is chosen; Status's ticks all four statuses. Clear sits beside View and Sort.
- **Review filter:** lists each review mark beside its name and doubles as the legend.
- **View:** Needs you first (the fold) or Mixed (one list). Named like a filter: its value shows once changed.
- **Pager:** numbered, 30px bordered squares; the current page takes the accent tint. The range reads "1 to 25 of 290".

### Menus and callouts

- **Menu:** Surface 3, Line Strong border, 10px corner. Opens from its trigger: opacity and scale from 0.97 over 180ms, ease-out. A menu that stays open while its content changes does not replay its entrance.
- **Callout:** opens after a 350ms pointer rest, or at once on focus where the anchor is focusable; a touch never opens it by hover. The shared Callout enters with opacity and a 4px slide over 140ms and takes no space when hidden; the SegmentedControl's own instant tip on the Brief page has not moved onto it yet.

### Motion

Durations 120, 180 and 320ms, the shared Callout's 140ms entrance, and a 350ms rest before a callout. Easing `cubic-bezier(0.23, 1, 0.32, 1)` for entrances and `cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement. On first load rows fade up 6px with a 30ms stagger, capped at twelve rows. Page change, sort, filter and keyboard movement never animate. Reduced motion keeps opacity changes only.

## Do's and Don'ts

- Do lead the personal line with a fact only this product knows. Don't greet.
- Do let a repeated value disappear (status Open). Don't print a column that says one word.
- Do keep the page flat: no page light on either page. Don't add a gradient; the URL box's submit sweep is a signal, not decoration.
- Do use the accent for what needs the reviewer. Don't use it for decoration or for state.
- Do give every new token a plan: where the Brief page adopts it and what it replaces.
- Don't add a card per row, a stat tile, an all-caps label, or monospace outside code and key caps.
