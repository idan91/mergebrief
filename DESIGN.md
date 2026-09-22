---
name: MergeBrief
description: A warm, dark reading surface for understanding a pull request before reviewing it.
colors:
  accent: "#ffc799"
  accent-ink: "#2a1a0c"
  ground: "#12100e"
  surface-1: "#171411"
  surface-2: "#1e1a16"
  surface-3: "#27221c"
  text-1: "#f0eae2"
  text-read: "#d2cabf"
  text-2: "#a89f94"
  text-3: "#9a9083"
  line: "#25201a"
  line-strong: "#362f27"
  state-open: "#7fd1a0"
  state-merged: "#b9a0e0"
  state-closed: "#ec8a8a"
  state-warning: "#e8c04a"
typography:
  display:
    fontFamily: "Instrument Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Instrument Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Instrument Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Instrument Sans, -apple-system, Helvetica Neue, sans-serif"
    fontSize: "0.78125rem"
    fontWeight: 400
    lineHeight: 1.4
  code:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.88em"
    fontWeight: 400
rounded:
  s: "5px"
  m: "8px"
  l: "10px"
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
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.m}"
    height: "32px"
    padding: "0 16px"
  button-secondary:
    textColor: "{colors.text-1}"
    rounded: "{rounded.m}"
    height: "32px"
    padding: "0 16px"
  url-box:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.l}"
    height: "44px"
  url-box-focus:
    backgroundColor: "{colors.surface-3}"
  list:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.l}"
  list-row:
    height: "56px"
    padding: "9px 16px"
  list-row-hover:
    backgroundColor: "{colors.surface-2}"
  list-row-cursor:
    backgroundColor: "{colors.surface-3}"
  chip:
    textColor: "{colors.text-read}"
    rounded: "{rounded.s}"
    height: "20px"
    padding: "0 7px"
  filter:
    rounded: "{rounded.m}"
    height: "28px"
  filter-changed:
    textColor: "{colors.accent}"
  menu:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.l}"
  avatar:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.round}"
    size: "26px"
---

# Design System: MergeBrief

Status: chosen on a throwaway prototype of Home, not yet built. Home leads this language and the Brief page follows it. The hue of the accent and of the warm greys is provisional until brand colours are picked; everything else here is decided.

## Overview

**Creative North Star: "The reading lamp"**

The product takes a pull request that is hard to read and makes it easy to read. The interface is the room you read it in at night: a warm dark page, one soft light near the top, text that is calm and large enough, and nothing blinking for attention. The three words it aims for are calm, mine, ready.

Warmth comes from the greys and the one accent. Structure comes from hairlines, not from raised cards. Impressive means exact alignment, generous type and instant response, never decoration.

**Key Characteristics:**

- Dark only. A warm near-black page with a single faint glow behind the top of the page.
- Hairline borders and row dividers, tinted warm. No card per row.
- One accent. It marks what needs the reviewer, the primary action, and focus.
- Two-line rows of 56px. Titles at 15px; the smallest text is 12.5px.
- Motion is rare and short. Keyboard movement never animates.

Never: a dashboard of stat tiles, a greeting, all-caps labels, monospace used as decoration, a badge on everything.

## Colors

Warm, low-chroma greys under one light peach accent. State colours keep a fixed meaning across the product.

### Primary

- **Lamp Peach** (#ffc799): review marks for rows that need the reviewer, the primary button, focus rings, the value of a changed filter, the current page. Dark text on it uses **Accent Ink** (#2a1a0c).

### Neutral

- **Ground** (#12100e): the page.
- **Surface 1, 2, 3** (#171411, #1e1a16, #27221c): the list, then hover and the URL box, then menus, the keyboard cursor row and the focused URL box.
- **Text 1** (#f0eae2): titles that need the reviewer, headings.
- **Text Read** (#d2cabf): titles already reviewed, chip text.
- **Text 2** (#a89f94): the second line of a row, labels, quiet icons.
- **Text 3** (#9a9083): placeholder text and unreachable rows. The floor for readable text.
- **Line, Line Strong** (#25201a, #362f27): row dividers and the list edge, then control borders.

### State (fixed meaning, hue may be tuned)

- **Open** (#7fd1a0), **Merged** (#b9a0e0), **Closed and failed** (#ec8a8a), **Warning** (#e8c04a). Draft is Text 2 with its own icon shape.

### Named Rules

**The Light Accent Rule.** The accent is always light: it is used as a fill under dark text and as small marks on a dark page. A dark or heavily saturated brand colour needs a lighter partner for the interface.

**The Four Lanes Rule.** Green, violet, red and amber belong to states. A brand hue inside one of them reads as a state. The free lanes are blue to cyan, pink to magenta, and orange to peach.

**The Tinted Grey Rule.** Greys carry the accent's hue at very low chroma. When the brand hue changes, the greys move with it, at the same lightness, so contrast holds. In OKLCH: ground 0.172, surfaces 0.198, 0.228 and 0.268, text 0.94, 0.84, 0.71 and 0.66, accent 0.87 at chroma 0.09.

**Contrast.** Text is 5:1 or better on every surface it sits on, and 5.5:1 or better on the page and the list; icons and state marks 3:1 or better. One deliberate exception: the URL box edge at rest is about 1.4:1, and the link icon, the placeholder and the slash key mark the field instead. Focus always shows a 2px accent ring.

## Typography

**Display and Body Font:** Instrument Sans (with -apple-system, Helvetica Neue, sans-serif)
**Code Font:** IBM Plex Mono, for code and commit hashes only

**Character:** One family at every size. Hierarchy comes from size, weight and the step from Text 1 to Text 2, not from a second typeface.

### Hierarchy

- **Display** (600, 1.875rem, 1.1, -0.02em): the personal line on Home. One per screen.
- **Title** (600, 0.9375rem, 1.2): section headings such as the list heading.
- **Row title** (500 when it needs the reviewer, 400 otherwise, 0.9375rem, 20px line): one line, cut with an ellipsis.
- **Body** (400, 0.9375rem, 1.5): running text, 65 to 75 characters wide at most.
- **Small** (400, 0.84375rem): controls, menus, the pager.
- **Label** (400, 0.78125rem, 18px line, tabular numerals): the second line of a row, chips, indicators.

### Named Rules

**The No Shouting Rule.** No all-caps labels and no letter-spaced small caps anywhere.

**The Code Only Rule.** Monospace appears only for code: inline code in a title, commit hashes, diffs.

## Layout

One centred column, 1080px wide at most, with a 24px gutter that becomes 16px under 760px. The Header is one 52px tier with a hairline under it.

Spacing uses one scale: 2, 4, 8, 12, 16, 24, 32, 48, 64. Blocks are grouped, not evenly spaced: the personal line and the URL box sit 16px apart as one group; the list begins 48px below them; a heading sits 12px above its list. There is always more space above a heading than below it.

The list splits at a fold. Rows that need the reviewer (new, updated since your review, in progress) come first; a quiet line reading "Nothing new below" follows; reviewed rows and the viewer's own come last. Each group keeps the chosen sort.

Under 760px the filters collapse behind one button, the sort drops to its own line, status labels become icons with hidden text, and long chip labels shorten. The page never scrolls sideways down to 320px.

## Elevation & Depth

Flat, with tonal layering. Surfaces step up in brightness; hairlines draw the edges. Shadows appear only on things that float or that invite input.

### Shadow Vocabulary

- **URL box at rest** (`inset 0 0 0 1px` of Text 1 at 9%, plus `0 14px 32px -16px rgb(0 0 0 / 60%)`): a faint edge and a soft lift.
- **URL box focused** (the same edge, plus `0 0 0 2px` of the accent at 50% and `0 18px 40px -16px` of the accent at 16%).
- **Menus and callouts** (`0 18px 44px -10px rgb(0 0 0 / 70%)`).
- **Page glow** (one radial gradient of the accent at 11%, 880 by 420px, centred left of the middle above the top edge): the lamp. It is the only gradient.

## Shapes

Small, consistent corners: 5px for chips and keys, 8px for controls, 10px for the list, the URL box and menus. Round is kept for people: the avatar is a circle. Borders are 1px. Chips are filled with a soft tint and have no border. Review marks are authored glyphs on a 14px grid with a 1.5px stroke: a filled dot (new), a half disc (in progress), a ringed dot (updated since your review), a ringed check (reviewed).

## Components

### Buttons

- **Shape:** 8px corner, 32px tall, 44px on a first screen.
- **Primary:** accent fill, Accent Ink text. One per view.
- **Secondary:** transparent with a Line Strong border.
- **Press:** scale to 0.97 over 150ms. No hover movement.

### URL box

- **Style:** Surface 2 fill, faint edge, soft shadow, 10px corner, 44px tall (60px in its prominent form). A link icon leads; the slash key hint sits at the end and gives way to the Generate button once text is entered.
- **Focus:** Surface 3 fill, 2px accent ring, warm shadow. The icon turns accent.
- **Submitting:** the field is replaced by one line of status and a thin accent sweep along the bottom edge.

### List and rows

- **Container:** Surface 1, 1px Line edge, 10px corner, Line dividers between rows. No card per row.
- **Row:** 56px, two lines. Line one is the mark, the title and chips. Line two is the source icon (URL pull requests only), repository, number, author and age, in Label type.
- **Right edge:** generation state (generating, queued, failed) and the status, right-aligned and flush. Status is printed only when it is not Open.
- **Hover:** Surface 2. Actions fade in over the right edge (opacity only, 120ms): Regenerate when behind, Open on GitHub, a menu with Copy link and Delete.
- **Keyboard cursor:** Surface 3 plus a 1px inset accent ring at 55%. It appears and moves with no animation.
- **Accessible name:** the row link reads the review state, status and source in words before the title. Icons are hidden from assistive technology.

### Chips

- **Style:** 20px tall, 5px corner, soft warm tint, no border, Text Read. A chip states a fact about a row: place in a stack, new commits (in Warning), unreachable.

### Filters, sort and pager

- **Filter:** 28px, 8px corner, Line Strong border. It shows its name only; a value appears when it is set, and several values show as a count. A changed filter takes an accent tint and an accent value. Clear sits beside Sort.
- **Review filter:** lists each review mark beside its name and doubles as the legend.
- **Pager:** numbered, 30px bordered squares; the current page takes the accent tint. The range reads "1 to 25 of 290".

### Menus and callouts

- **Menu:** Surface 3, Line Strong border, 10px corner. Opens from its trigger: opacity and scale from 0.97 over 180ms, ease-out. A menu that stays open while its content changes does not replay its entrance.
- **Callout:** hover only, after 350ms, opacity only. It takes no space when hidden.

### Motion

Durations 120, 180 and 320ms. Easing `cubic-bezier(0.23, 1, 0.32, 1)` for entrances and `cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement. On first load rows fade up 6px with a 30ms stagger, capped at twelve rows; a newly added row flashes the accent tint once. Page change, sort, filter and keyboard movement never animate. Reduced motion keeps opacity changes only.

## Do's and Don'ts

- Do lead the personal line with a fact only this product knows. Don't greet.
- Do let a repeated value disappear (status Open). Don't print a column that says one word.
- Do keep the glow as it is: a light to read by. Don't turn light into a signal or add a second gradient.
- Do use the accent for what needs the reviewer. Don't use it for decoration or for state.
- Do give every new token a plan: where the Brief page adopts it and what it replaces.
- Don't add a card per row, a stat tile, an all-caps label, or monospace outside code.
