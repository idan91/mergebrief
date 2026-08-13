# Button component spec (BRIEF-187)

Locked spec for the shared button component set in `apps/web/src/components/`.
Product of the wayfinder map "One Button component with variants — retire `.btn`";
decision detail lives in the map's closed tickets. Companion doc:
`button-migration-plan.md`. Inputs: `button-call-site-census.md`,
`button-reference-api-read.md`.

Decision-only: no component code ships with this doc.

## Component set (8)

Sibling set, not one wide Button — a wide variant union makes every prop
conditional on every other; siblings keep each contract honest.

| Component | Sites | Owns |
|---|---|---|
| Button | ~50 | standard actions (MIGRATE bucket); `primary/secondary/quiet` × `sm/md`; `as="a"` |
| LinkButton | ~13 | inline text actions ("text that acts"); `font: inherit` |
| IconButton | ~11 | icon-only actions incl. steppers; required accessible name |
| Chip | ~8 | pressed toggles, status chips, count pills |
| RowButton | 7 | full-width row/card-as-button |
| ToolbarButton | 5 | boxed toolbar pressed/disclosure trigger |
| MenuItem | 7 | `role=menuitem*` + checked states |
| AccessibleLink | sweep | unstyled semantic `<a>`; `_blank` announcement |

### Deliberately-bespoke test

A call site stays bespoke (raw `<button>` + lint disable-with-reason) when ANY holds:

1. Hit area is not the visual element (scrim, gutter overlay, mini-map tick, progress segment).
2. Content is arbitrary block layout, not text/icon (rail chunk card, ConcernView row).
3. Singleton role plumbing no sibling models (`role=tab`; tooltip anchors with `cursor: help`, no onClick).

Tab (MarkdownTextarea) stays bespoke under rule 3.

## Spec-wide conventions

Every component in the set:

- **Co-location:** `apps/web/src/components/<Name>/` with its own module scss.
  Exported prop types; `forwardRef` + `displayName`; `type="button"` default on
  button-rendering components.
- **Styling API:** one CSS-module class per component + `data-*` attributes for
  variant state (`data-variant`, `data-size`, …). No per-variant classes; no
  global button classes survive.
- **Disabled model (repo rule, owned by the components):** a single `disabled`
  prop always renders `aria-disabled="true"` plus an internal click/keyboard
  guard. The native `disabled` attribute is never rendered and is
  type-unrepresentable (`Omit<ButtonHTMLAttributes<…>, "disabled">`). No escape
  hatch. `aria-describedby` passes through for disabled-reason patterns.
  Modules style `[aria-disabled="true"]`, never `:disabled`.
- **Base + AsX type pattern** for every polymorphic component:
  `<Name>BaseProps` (own props, never carries `as`) + one exported
  `<Name>AsXProps` per element branch + `<Name>Props` union. Element sets are
  `as const` maps + `ValueOf` (e.g. `BUTTON_ELEMENTS = { BUTTON: "button",
  ANCHOR: "a" }`). Default element's `as` is optional; other branches require it.
- **State-ownership rule:** a component owns an ARIA state prop only when the
  semantic is its identity (Chip `pressed`, MenuItem `checked`). Cross-item or
  disclosure state stays at the call site and rides rest-spread
  (`aria-expanded`, roving `tabIndex`). Controlled props only — no internal
  toggle state.
- **Copy via `packages/i18n`**; icon SVGs carry `aria-hidden="true"
  focusable="false"`; `:focus-visible` outline posture; `data-*` test hooks and
  refs pass through untouched.

## Button

- **Variants:** `variant: "primary" | "secondary" (default) | "quiet"`.
  `secondary` = today's bare `.btn` outline (unmarked case → minimal migration
  diffs); `primary` = filled; `quiet` = the `rowStyles.action` grammar
  (standard actions living in rows — distinct from RowButton, which is
  whole-row-as-target). No `link` variant (LinkButton is the sibling), no
  `destructive` (zero demand today; non-breaking to add later).
- **Sizes:** `size: "sm" | "md" (default)`. `sm` = today's `.btn.compact`
  numbers (4/10 pad, radius-sm, 12px/500); `compact` renames to `sm`. No `lg`
  (zero demand; inventing numbers = redesign, out of scope). Axes compose
  freely; quiet sites simply never pass `size`.
- **Polymorphism:** `as?: "button" (default) | "a"` — closed union, not generic
  `ElementType`. `href` required on the anchor branch. `as="a"` renders through
  AccessibleLink (announcement logic lives once).
- **`loading?: boolean`:** renders `aria-busy="true"` + the same interaction
  guard. No spinner, no layout change; label stays visible (call sites swap
  copy via i18n). Composes independently with `disabled`. Built in, not a
  wrapper.
- **No pressed/selected API** — toggle semantics belong to Chip/ToolbarButton.

```typescript
export type ButtonBaseProps = {
  variant?: ButtonVariant; // ValueOf<typeof BUTTON_VARIANTS>
  size?: ButtonSize;       // ValueOf<typeof BUTTON_SIZES>
  disabled?: boolean;      // aria-disabled only — see disabled model
  loading?: boolean;
};
export type ButtonAsButtonProps = { as?: "button" } & ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled">;
export type ButtonAsAnchorProps = { as: "a"; href: string } & ButtonBaseProps &
  AnchorHTMLAttributes<HTMLAnchorElement>;
export type ButtonProps = ButtonAsButtonProps | ButtonAsAnchorProps;
```

## LinkButton

Inline text action — always `font: inherit`; no variant or size axes (one
grammar: "text that acts" takes its context's font). `aria-expanded`
passthrough for link-styled disclosures. Absorbs the link-button FAMILY rows
plus the link-like former-bespoke rows (file-path jumps, delta links,
description toggles, MarkReadyModal prose jumps).

## IconButton

- `size: "sm" (24px, default) | "md" (32px) | "lg" (34px)`. Today's 26px
  toolbar skin folds into `sm` (2px nudge — flag in its migration PR);
  the 18px BriefDetailsPanel trigger becomes `sm` with a 24px hit area,
  fixing the min-target violation.
- `variant: "ghost" (default) | "outlined"` (timeline arrows = outlined md;
  header circles = outlined lg).
- `label: string` required → renders `aria-label={ariaLabel ?? label}` —
  explicit coalesce; a caller's `aria-label` overrides.

## Chip

- `ChipBaseProps = { tone?: "neutral" (default) | "warning" }`.
- Elements: `CHIP_ELEMENTS = { BUTTON: "button", SPAN: "span" }`. Button branch
  adds `pressed?: boolean` → `aria-pressed` (controlled; never inferred from
  clicks). Span branch is static rendering (status chips when inert, count
  pills) — no interactive props. Disclosure chips pass `aria-expanded` through.

## RowButton

- `variant: "row" (default) | "card"` (card = the modal unresolved-item pair);
  `density: "full" (default) | "slim"` (row only); both as data-attrs.
- Absorbs `rows.module.scss .rowButton` and the InlineThreads copy. Exists
  because the row-as-button contract is today spread over 5+ files with no
  place to hang a11y invariants.

## ToolbarButton

Prop-less skin — no variants, sizes, or owned state; `aria-pressed` /
`aria-expanded` pass through. Its whole value: the byte-identical
15-declaration toolbar box (currently pasted three times) lands in one module.
Skin tweaks become data-attrs later only if migration demands them.

## MenuItem

Role-discriminated union: `MENU_ITEM_ROLES = { ITEM: "menuitem", RADIO:
"menuitemradio", CHECKBOX: "menuitemcheckbox" }`; radio/checkbox branches
require `checked: boolean` → `aria-checked`. Roving tabindex is the parent
menu's (cross-item state); `tabIndex` passes through. **Menu triggers are not
MenuItem** — they are Button `secondary` with a caret child and
`aria-haspopup`/`aria-expanded` passthrough.

## AccessibleLink

`AccessibleLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>` — full
passthrough including `className`. Ships zero CSS; never forbids styling.
When `target="_blank"`: defaults `rel="noreferrer"` and appends a
`ScreenReaderOnly` "opens in new tab" (i18n key `a11y.opensInNewTab`).
No variants, no data-attrs, no module file. Button `as="a"` renders through it.
