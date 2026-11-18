# MergeBrief design rules

The rules a frontend change in `apps/web` must follow. Each rule names the token or value to use.

- The values live in `apps/web/src/styles/tokens.scss`. Where this file and the tokens disagree, the tokens win and this file is corrected.
- `apps/web/AGENTS.md` holds the stylelint mechanics: units, which properties must read a token, and how a disable is written.
- The tests in `apps/web/src/styles` hold the contrast lines, lane separation, breakpoints and stacking order. A red test there blocks the change.

## Principles

- One dark palette. There is no light theme.
- Flat surfaces. Depth comes from brightness steps and 1px hairlines. A list is one container with dividers, never a card per row.
- No backdrop blur. Bars and panels that sit over content take an opaque fill.
- One accent, one brand colour and four state colours. There is no info colour: a note that is neither a state nor the brand is neutral.
- Every colour, font size, radius, shadow, spacing step, duration and `z-index` reads a token.

## Colour

### Using tokens

- A component reads a semantic token (`--color-*`). Primitives (`--gray-*`, `--accent-400`, `--green-400`, `--vermilion-500` and their kin) stay inside `tokens.scss`.
- A token is named for its role, never for its value.

| Role         | Token                  | Where it goes                                                                   |
| ------------ | ---------------------- | ------------------------------------------------------------------------------- |
| Ground       | `--color-ground`       | The page and the Header.                                                        |
| Focus ground | `--color-focus-ground` | Focus mode. Black, one step below the page.                                     |
| Chrome       | `--color-chrome`       | The Brief header's compare row and the sidebar's column, panel and narrow bar.  |
| Card         | `--color-card`         | The Brief's reading cards. `--color-card-sunken` frames a block inside one.     |
| Well         | `--color-well`         | The diff's code area, a step below Surface 1.                                   |
| Surface 1    | `--color-surface-1`    | The list, sheets and code blocks.                                               |
| Surface 2    | `--color-surface-2`    | Hover and the URL box.                                                          |
| Surface 3    | `--color-surface-3`    | Menus, dialogs, toasts, a pressed row and the keyboard cursor row.              |
| Scrim        | `--color-scrim`        | Behind dialogs and sheets.                                                      |
| Text 1       | `--color-text-1`       | Headings, and titles that need the reviewer.                                    |
| Text Soft    | `--color-text-soft`    | Reviewed titles, chip text and reading prose.                                   |
| Text 2       | `--color-text-2`       | Second lines, labels and quiet icons.                                           |
| Text 3       | `--color-text-3`       | Placeholders, unreachable rows and line numbers. The floor for readable text.   |
| Decorative   | `--color-decorative`   | Separators only. Never text.                                                    |
| Line         | `--color-line`         | Dividers and default borders.                                                   |
| Line Strong  | `--color-line-strong`  | The borders of buttons, filters, menus and dialogs.                             |
| Control Edge | `--color-control-edge` | A form control's edge at rest: text fields, selects, checkboxes, the URL box.   |

### Accent and brand

- `--color-accent` is a white: chroma 0 at 91% lightness. It draws focus rings, links, pressed and active controls, the selected diff row, a changed filter's value and the current page.
- The accent is never a primary button's fill, a state or decoration.
- **The Brand Colour Rule.** `--color-brand` appears in three places only: the mark, the fill of the one primary action in a view, and the Brief header's review progress bar. It is never a state, a link, focus or selection.
- One primary button per view. Its label is `--color-on-brand`. Hover takes `--color-brand-strong`; press mixes 12% of `--color-ground` into that. A primary only darkens.

### States and tints

- Four state colours with fixed meanings: `--color-positive` (open, added), `--color-merged` (merged), `--color-negative` (closed, failed, deleted, errors, destructive actions) and `--color-warning` (look here, or this brief may be wrong).
- `--color-warning` is for warnings only. A change to read, such as new commits, takes the accent tint.
- A state fill is the state colour over transparent at one of four strengths: `--tint-faint` 5%, `--tint-subtle` 8%, `--tint-medium` 12% and `--tint-strong` 18%.
- Read a `--color-<state>-tint-<strength>` token, such as `--color-warning-tint-medium`. A fill whose colour varies per element mixes that colour at a `--tint-*` strength, as `Badge` does with `--badge-color`.

### Concern

- One hue per concern: `--color-concern-implementation`, `-test`, `-doc`, `-spec`, `-config` and `-generated`. `--color-concern-unattributed` is the one neutral.
- Marks only. A concern colour draws a dot or a split segment, never words.
- Set it with `mixins.concern-color`, which reads `data-concern` and publishes `--concern-color`.
- In vocabulary order, neighbours alternate light and dark. Hue alone parts some pairs, so a concern mark always sits beside its concern's name.
- A new concern adds a token and a branch in the mixin. The contrast test fails without either, and holds every concern colour at 3:1.

### The One Hue rule

- The theme is four numbers in `tokens.scss`: `--theme-hue` (286), `--accent-l` (91%), `--accent-c` (0) and `--gray-c` (0.01).
- The accent and every grey derive from them in OKLCH at fixed lightness steps, so the palette moves together and every contrast holds.
- A new grey is an `oklch()` step on `--gray-c` and `--theme-hue`, never a hex. No component states the hue.

### The Tinted Grey rule

- Greys carry the theme hue at one low chroma, `--gray-c`. Two exceptions: the decorative grey doubles it and Text 1 takes a third.
- Changing `--theme-hue` moves every grey at the same lightness. Setting `--gray-c` to 0 makes every grey neutral without touching the accent.
- Surface 3 sits below Line in lightness on purpose: a menu's fill is darker than the hairline that edges it.

### The Four Lanes Rule

- Green, violet, crimson and amber belong to the states. The brand owns the vermilion lane. A hue inside a lane reads as that state or as the brand.
- A state or concern colour within 20 degrees of the brand's OKLCH hue sits at least 0.05 darker in lightness, or at no more than 75% of the brand's chroma. `lane-separation.test.ts` holds this.
- A new colour picks a hue outside the lanes, or passes that test.

## Contrast

`contrast.test.ts` holds every line below against the tokens. A new text, surface or mark token joins that test's lists.

- **Words 5:1** or better on every surface (Ground, Surface 1, 2 and 3), and 5.5:1 on the page and the list (Ground and Surface 1). The accent and the state colours also set words, so they are held at the same two lines.
- **Marks 3:1** or better on every surface: the concern colours and the brand mark.
- A form control's edge at rest is 3:1 or better on every fill a control sits on or holds, the Inbox's selected row included.
- **Exception at the AA line (4.5:1): the selected diff row.** It lifts the well by 14% of the accent (`--diff-selected-tint`) and its number cells by 24% (`--diff-selected-gutter-tint`). Code and syntax colours read against the row, and the numbers in Text 1 against the number cells, at 4.5:1 or better.
- Also held at 4.5:1: the white label on `--color-brand` and `--color-brand-strong`, and a badge's words on their own tint over every surface, at rest and under the pointer.

## Typography

- `--font-sans` (IBM Plex Sans) everywhere. `--font-mono` (IBM Plex Mono) only under the Code Only Rule. Hierarchy comes from size, weight and the step from Text 1 to Text 2, never a second typeface.
- Both are self-hosted through `@fontsource`, loaded in `styles/app.scss` at 400, 500 and 600. Use no other weight.
- Seven sizes, stated in rem so they follow the reader's browser font size:

| Token           | Size | For                                                            |
| --------------- | ---- | -------------------------------------------------------------- |
| `--font-size-1` | 11px | Badges, meta rows and key caps. The smallest step.             |
| `--font-size-2` | 13px | Sentences in the interface, control labels and code.           |
| `--font-size-3` | 15px | Row titles, section titles and reading prose.                  |
| `--font-size-4` | 17px | Panel titles and the lead line.                                |
| `--font-size-5` | 20px | Page and group titles, and the Header lockup.                  |
| `--font-size-6` | 24px | The Brief header's pull request title.                         |
| `--font-size-7` | 30px | The one line that owns a screen. It drops to 24px under 760px. |

- Line height reads a `--line-height-*` step: control 1, display 1.1, heading 1.2, compact 1.35, body 1.5, reading 1.7. A row whose height other code counts sets a fixed line box with `functions.to-rem()`.
- `--font-size-root` is the body's 14 to 15px clamp, the only fluid value. It is not a step; a component names a step.
- A text field includes `mixins.touch-field-text`, which sets 16px on a coarse pointer so the browser does not zoom into the field.
- **The No Shouting Rule.** No all-caps labels and no small caps. `text-transform` is not used.
- **The Code Only Rule.** Mono is for code and what identifies code: inline code, code blocks, diffs and their line numbers, file paths, commit hashes, branch names, model ids and key caps. Counts and positions set in the sans with `font-variant-numeric: tabular-nums`.

## Spacing and layout

- Spacing reads `--space-*`: 2, 4, 6, 8, 10, 12, 14, 16, 24, 32, 48 and 64px. The 6, 10 and 14px steps are `--space-2-5`, `--space-3-5` and `--space-4-5`.
- Group blocks, do not space them evenly. Leave more space above a heading than below it.
- A page column is 1080px wide at most, centred by `--page-gutter`: 24px at least, 16px under 760px. The Header shares the gutter.
- The Header is one `--header-h` (52px) tier with a `--color-line` hairline under it and no fill of its own.
- **The Header lockup.** One link holding the mark in `--color-brand` at 1.3em beside the wordmark, set at `--font-size-5` in `--color-text-1`. The gap between mark and wordmark is 0.4em, so it scales with the wordmark.
- Breakpoints come from `mixins.for-breakpoint`: `small-mobile` 760px, `mobile` 880px, `tablet` 1120px and `landscape-height` 500px. `breakpoints.test.ts` holds each equal to its TypeScript copy. A phone is `mixins.for-phone`: 880px wide or less, or the sideways shape in `mixins.for-landscape-phone`.
- On the Brief page, anything that must sit clear of the pinned stack reads `--sticky-stack-h`. Do not re-add its parts.
- `z-index` reads `functions.get-z-index("<layer>")`. The order is the `$z-layers` list in `styles/_functions.scss`, lowest first, with the toast on top. A new overlapping thing takes its own entry.

## Shape and elevation

- Corners: `--radius-xs` 2px (bars and markers), `--radius-sm` 4px (key caps, inner corners, small buttons), `--radius-chip` 6px (chips, badges, tooltips), `--radius-md` 8px (controls, toasts) and `--radius-lg` 12px (the list, the URL box, menus, dialogs, a sheet's top corners). `--radius-circle` is for avatars and dots, `--radius-pill` for pills, grips and scrollbar thumbs.
- An inner corner is its surface's radius less its inset: `functions.inner-radius()`. Borders are 1px.
- Shadows appear only on what floats or invites input: `--shadow-float` (menus, popovers, callouts, dialogs), `--shadow-sheet` (sheets, the toast), `--shadow-raised` (raised in place), `--shadow-tooltip` (compact callouts), and `--shadow-lift` with `--shadow-lift-focus` (the URL box). Build a ring or an edge bar with `functions.ring`, `functions.inset-ring` or `functions.edge-bar`.
- **The Mechanism Gradient Rule.** A gradient never colours a surface. It appears only as a mechanism: a sweep, a skeleton shimmer, a scroll-edge shadow, a mask or fade, a hatch, the progress bar's ramp.

## Icons

- One family, Phosphor at the Bold weight, one file per icon: `apps/web/src/components/icons/<phosphor-name>.svg`. A new icon also joins `IconNames` and the glyph map in `components/Icon`.
- Render through `Icon`. Three sizes: 12 in a chip, 14 in a control, 16 in a row or a state. Colour is `currentColor`, set by the site's token.
- Direction by rotation: one drawing per shape, turned in quarter steps with `rotation`. No mirrored files.
- Without `label` an icon is decorative and `aria-hidden`; the control or row around it carries the name. With `label` it takes `role="img"`.
- The mark and the wordmark are committed files outside the set: `mergebrief-mark.svg` and `mergebrief-wordmark.svg`.

## Components

Shared primitives live in `apps/web/src/components`. Use one before writing a raw element.

### Buttons

- `Button` variants: `primary`, `secondary` (the default), `quiet`, `danger`, `ghost` and `ghost-danger`. Sizes: `md` and `sm`.
- Corner `--radius-md`. The `sm` size takes `--radius-sm`, except on the two ghosts. Secondary is transparent with a `--color-line-strong` border.
- Danger is outline only: `--color-negative` text and edge, `--color-negative-tint-medium` under the pointer. There is no filled danger.
- Ghost and `IconButton` have no edge or fill, in Text 2. Under the pointer they take Surface 3 and Text 1.
- Press: `Button`, `IconButton` and the filter trigger scale to 0.97 over `--motion-fast` on the entrance curve. Rows and toolbar buttons step their background instead. Hover changes colour, never a control's position.
- Disabled: `aria-disabled="true"` with `mixins.dimmed`, which dims to `--opacity-disabled` (45%). The control stays focusable and its focus ring keeps full strength; `dimmed-focus.test.ts` holds this.

### Lists and rows

- Container: Surface 1, a 1px `--color-line` edge, `--radius-lg`, and `--color-line` dividers between rows.
- A row is 56px tall at least, with two lines: the title at `--font-size-3`, weight 500, on a 20px line; the second line at `--font-size-2` in Text 2 on an 18px line.
- The title is Text 1 when the row needs the reviewer and Text Soft otherwise.
- Hover is Surface 2 and press is Surface 3. The keyboard cursor is Surface 3 plus a 1px inset ring in `--color-cursor-ring`, and never animates.
- On first load, rows fade up 6px with a 30ms stagger, capped at twelve rows.

### Chips and badges

- `Chip`: `--radius-chip`, a fill of Text 1 at 7%, weight 500, Text Soft, 26px tall at least. The `fact` variant is 20px tall.
- A pressed or changed chip takes `--color-accent-tint-subtle` behind `--color-accent-edge`, with accent text. A warning chip sits on `--color-warning-tint-medium` and takes `--color-warning-tint-strong` under the pointer.
- `Badge`: `--radius-chip`, `--font-size-1`, weight 500, its own colour at `--tint-medium`, the words in their own case.

### Filters and pager

- Filter trigger: 28px tall, `--radius-md`, a `--color-line-strong` border, Surface 2 under the pointer. A changed filter takes `--color-accent-tint-subtle`, `--color-accent-edge` and an accent value.
- `ToolbarButton` wears the same edge and corner. Active takes the accent tint; a mixed state adds a dashed edge, so it never rests on colour alone.
- **The pager.** Numbered 30px squares: 30px tall and 30px wide at least, a `--color-line-strong` border and `--radius-md`. The current page takes `--color-accent-tint-medium`, `--color-accent-edge` and accent text.

### Floating surfaces

- Menus, popovers and callouts: Surface 3, a `--color-line-strong` border, `--radius-lg` and `--shadow-float`. Build them on `Popover`, `Menu`, `Dropdown` or `Callout`.
- A compact callout is the tooltip: `--radius-chip` and `--shadow-tooltip`. It opens after a 350ms pointer rest, or at once on keyboard focus. Within 600ms of one leaving, the next opens with no delay and no entrance.
- Dialog (`Modal`): Surface 3, a `--color-line-strong` border, `--radius-lg`, `--shadow-float`, 24px padding, 460px wide (560px for the wide box), over the scrim.
- Bottom sheet: `mixins.bottom-sheet-chrome`. Surface 1 under a `--color-line-strong` top edge, `--radius-lg` top corners, `--shadow-sheet`, half the viewport tall.
- Toast: Surface 3, a `--color-line-strong` border, `--radius-md`, `--shadow-sheet`, `--font-size-2` at weight 500, 560px wide at most. It hides with opacity so its live region stays in the accessibility tree.
- URL box: 44px tall, Surface 2, `--radius-lg`, an inset `--color-control-edge` ring plus `--shadow-lift`. Focused, it takes Surface 3 and `--shadow-lift-focus`.

## Motion

- Durations: `--motion-fast` 120ms (hover, colour, press, leaving), `--motion-base` 180ms (entering) and `--motion-slow` 320ms (a sheet rising, the first-load rise). Single-purpose durations: `--motion-slide` 260ms, `--motion-spin` 700ms, `--motion-read` and `--motion-flash` 1.4s.
- **The entrance curve** is `--ease-out`, `cubic-bezier(0.23, 1, 0.32, 1)`: for anything entering and for a press. JavaScript that cannot read the token copies this value.
- On-screen movement takes `--ease-in-out`, `cubic-bezier(0.77, 0, 0.175, 1)`. `--ease-drawer` belongs to the focus panel's slide alone.
- What enters takes 180ms and leaves over 120ms: dialogs and the toast do both. A popover enters with opacity and scale from 0.97, a dialog from 0.98.
- Keyboard movement never animates.
- Reduced motion: `base.scss` limits every transition to opacity, colour and shadow. Anything that moves by transform or keyframes states its own reduced form: a press does not scale and a rise fades in place.

## Accessibility

- Focus is one ring: `mixins.focus-ring` or `mixins.focus-visible`. 2px solid `--color-focus-ring` at a 2px offset, 3px under `prefers-contrast: more`. Never restate its geometry. The one exception is the Markdown field, which marks focus with an accent edge and `--shadow-field-focus`.
- **The Hover Rule.** Every `:hover` sits inside `mixins.hover`, so a tap never leaves one stuck; stylelint holds it. A control that hover reveals needs a touch route.
- A small control grows its hit area to the 24px floor with `mixins.hit-area`. Text that only a screen reader needs takes `.sr-only`.
- Colour never carries a state alone: pair it with words, an icon or an edge style.
- Forced colours: a state drawn by fill alone takes `mixins.forced-selected`, `mixins.forced-current` or `mixins.forced-fill`.
