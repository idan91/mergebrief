# Button reference API read (BRIEF-187)

What the reference component repo (`/Users/idan/Projects/Code/components`, the
SegmentedControl source) offers for a Button API, and what transfers to our
spec. Read at `b45e478` (main) plus two unmerged branches.

## Reference Button (main)

`src/components/Button/Button.tsx` — the oldest component in the repo, and it
shows: it predates the conventions the newer components settled on.

```ts
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  loading?: boolean;
}
```

- Renders `<button type="button">`, spreads rest props, merges `className`.
- Class emission: **global BEM classes** — `btn`, `btn--primary`, `btn--sm`,
  `btn--full-width`, `btn--loading` — via plain `.scss` import (not a CSS
  module). This is exactly the global-`.btn` pattern our effort retires.
- State handling: `disabled={disabled || loading}` — **hard `disabled`**;
  loading renders an absolute-positioned spinner and hides the label with
  `visibility: hidden`. No `aria-busy`, no `aria-live`; the accessible name
  vanishes while loading.
- No `forwardRef`, no polymorphism (`as` prop does not exist anywhere in the
  repo — checked), no icon-slot props.
- Styling details worth keeping: `:focus-visible` outline (2px, offset 2px),
  `inline-flex` + `gap` layout, `white-space: nowrap`, spinner sized in `em`
  so it scales with font-size.

## Unmerged branch: `fix/button-data-attrs`

Rewrites class emission: a single `.btn` class plus
`data-variant` / `data-size` / `data-full-width` / `data-loading` /
`data-rounded` attributes carry all variant state (also adds a `rounded` pill
prop). Props API unchanged. This is the repo's direction of travel for
variant plumbing: one stable class, attributes as the styling API — selectors
become `.btn[data-variant='primary']`.

## Unmerged branch: `feature/copy-button`

`CopyButton` — the repo's only sibling-button precedent, and it does **not**
compose `Button`. It is its own `<button>` with its own CSS module, a
`.facade.ts` hook (clipboard + timeout state machine), a `.types.ts` file, a
`data-status` attribute for styling, `aria-live="polite"` for the status flip,
and a render-prop `children(status)` for custom labels. Inline SVG icons carry
`aria-hidden="true" focusable="false"`.

Signal for the sibling-set grill: the reference chose *parallel sibling*, not
*composition wrapper*, for a specialized button — but it predates our
no-behavior-wrappers/fold-into-shared discussion, so it is a data point, not
an answer.

## Newer-component patterns (Checkbox, SegmentedControl Option)

The repo's later components converged on conventions Button lacks:

- `forwardRef` with `displayName`.
- Accept `'aria-disabled'` as a first-class prop and coalesce:
  `const disabled = Boolean(disabledProp ?? ariaDisabled)` — then stamp
  `aria-disabled` on the rendered elements.
- CSS modules + `clsx`; kebab-case block names (`copy-button__icon`).
- Component folder: `.tsx` / `.module.scss` / `.types.ts` / `.facade.ts` /
  `.stories.tsx` / `.test.tsx` / `index.ts` (STYLEGUIDE.md codifies this).

## What transfers

- **Exported `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`**
  — matches our exported-prop-interface convention; rest-spread keeps every
  native attribute working.
- **Axis shape**: one `variant` axis + one `size` axis + independent boolean
  modifiers (`fullWidth`, `loading`). Clean, and maps onto the census
  buckets.
- **Data-attribute styling API** (the `fix/button-data-attrs` shape): one
  scoped class + `data-variant`/`data-size` attributes. Best fit for our
  goal — the class becomes a CSS-module internal, and no global `.btn`
  survives.
- **`type="button"` default** — kills the accidental-submit class of bugs.
- **Loading blocks interaction** and spinner-overlays-label layout (reserves
  width, no layout shift); `em`-sized spinner.
- **`:focus-visible` outline** posture.
- **File structure + facade/types conventions** from STYLEGUIDE.md — already
  our own convention via SegmentedControl.
- **Icon SVG hygiene**: `aria-hidden="true" focusable="false"`.

## What must differ

- **Polymorphism**: reference has none. Our census has 2
  `<a class="btn primary">` migrate sites — the spec must answer `as="a"`
  (or a `ButtonLink` sibling) itself; no precedent to lean on.
- **Disabled posture**: `disabled={disabled || loading}` hard-disables —
  violates our repo rule (`aria-disabled`, never hard `disabled`) and the
  census's 10 deliberate `aria-disabled` sites. Adopt the newer-component
  coalescing instead, render `aria-disabled`, and guard the click in the
  component.
- **Loading a11y**: hiding the label with `visibility: hidden` erases the
  accessible name. Spec should keep the name, add `aria-busy`, and mark the
  spinner `aria-hidden`.
- **`forwardRef`**: reference Button lacks it; ours needs it (menus, focus
  management call sites in the census).
- **Union style**: bare string-literal unions → our `as const` map +
  `ValueOf` rule.
- **Variant vocabulary**: `primary/secondary/outline/ghost` does not cover
  the census's quiet/row (`rowStyles.action`, 12 sites) or the open `link`
  question — vocabulary is the grill's to set, not inherited.
- **No `enum`-adjacent gaps**: reference has no icon-only support (our
  min-24×24 target rule) and no i18n hook (our copy rides `packages/i18n`);
  both are ours to specify.
