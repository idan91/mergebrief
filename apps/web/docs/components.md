# apps/web components, hooks and state

## Components

- **Decompose at birth, not on review.** Every sub-component gets its own nested folder plus `module.scss`. Prop interfaces are exported (`interface XProps`) and declared in the component file, never inline in the signature; a lone `XProps` stays there. A function or const inside a component or facade stays there only when it closes over its state; anything that can take its inputs as arguments goes to a co-located `utils.ts`/`consts.ts` with a co-located unit test. A `types.ts` is for non-prop types a file would otherwise grow: shared unions, maps several files need, or a discriminated prop shape that depends on a base type.
- **Fold capability into the shared component; no behaviour wrappers.** A generic capability (positioning, hover, anchoring) belongs in the component's own API. `HoverX`/`AnchoredX`/`XWrapper` forks its identity. A wrapper is only justified when it encodes a product feature's domain mapping.
- **One `.svg` asset file per mark or icon**, imported via svgr. Never a collection of path data grouped into one `.tsx`.
- Heading levels follow document structure, never size: one `h1` per screen (a state/error card that replaces the screen owns it), `h2` for a top-level section, overlay content rooted at `h2`, no skipped levels. A component that wants a different size pins one in its own module; a shared shell styles headings level-agnostically so it never dictates a level. Authored markdown through `components/Markdown` is exempt: it keeps its fixed h1→h3/h2→h4 demotion. Reviewer-held: no lint rule expresses it.

## DOM attributes

`data-testid` for test selection; `data-state`/`data-variant` for styling. CSS targets attributes, not toggled classes. Extracted components adopt both at birth.

A behavioral third category (an attribute runtime code queries for) needs an exported constant and its own doc comment, never a bare literal, never doubling as a test or styling hook. Thirteen exist:

- `DiffRows` and its `SplitRows` write five, read through `components/DiffRows/consts.ts`: `data-line-origin` through its selectors, `data-line-old` / `data-line-new` through `LINE_ATTRIBUTES`, `data-line-number` through `EXPANDED_RIGHT_NUMBER_SELECTOR`, and `data-line-stop` through `LINE_STOP_SELECTOR`, whose `LineStops` value `useLineStops` reads to keep one line of a diff table in the Tab order and to step the arrow keys within one column.
- `Callout` writes `data-callout` on its floating root, read through `CALLOUT_ROOT_SELECTOR` in `components/Callout/consts.ts`.
- A `BottomSheet` caller writes `data-sheet-focus` on the control focus lands on, read through `SHEET_FOCUS_SELECTOR` in `components/BottomSheet/consts.ts`.
- The Brief page's `SubmitReviewCta` and `MarkReadyCta` write `data-terminal-slot`, read through `TERMINAL_SLOT_SELECTOR` in `features/brief/ui/components/BriefView/consts.ts`.
- `LandscapeRow` and `PhoneBar` write `data-scroll-steering`, read through `SCROLL_STEERING_SELECTOR` in `BriefView/scroll-to-target/engine/consts.ts`.
- `CollapsibleBar` writes `data-bar-open` and `data-bar-panel`, read through `OPEN_BAR_SELECTOR` and `BAR_PANEL_SELECTOR` in `components/CollapsibleBar/consts.ts`.
- The Sidebar sheet's `ChunkRows` writes `data-chunk-row`, read through `CHUNK_ROW_SELECTOR` in its `consts.ts`.
- `InboxRow` writes `data-row-link` on its link to the brief, read through `ROW_LINK_SELECTOR` in `features/inbox/components/InboxList/consts.ts`.

One readiness mark sits beside them, read by the browser suite and by no runtime code: `useKeyboardShortcuts` writes `data-shortcuts-live` on the root element in the effect that binds its listener, read through `SHORTCUTS_LIVE_ATTRIBUTE` in `features/brief/ui/hooks/consts.ts`.

## Hooks and JSX

- **One facade per component.** A component carrying heavy logic gets one co-located `use<Component>Facade` hook (`useAttributedGroupCardFacade` is the template) and stays thin: the component wires props in and moves JSX into subcomponents; the facade owns flow state (pending, error, copy), store subscriptions, flow actions and derived selection. A facade's return is inferred from the object it returns, never a `*FacadeReturn` type. Splitting a facade does not make more facades: the pieces are named for their job (`useReading`, `useViewLayout`), never `use*Facade`, never in a `facade/` folder. A piece lives by usage: the concern folder it serves, else a `hooks/` folder beside the component, else promoted by the co-location rule.
- **A function is a hook only if it calls one.** A `useMemo` body that only computes is a pure function in `utils.ts` with a test, and the hook keeps the one-line memo.
- Memoize (`useMemo`, `useCallback`, `memo`) only for a measured cost or a contract-visible need such as a stable dependency a child effect keys on.
- No spread inside JSX, except a primitive forwarding its rest props to its own DOM element, or a floating-ui prop bundle (`getReferenceProps`, `getFloatingProps`, `getItemProps`) onto the element floating-ui positions or the primitive that forwards it: that bundle is the library's contract and has no stable member list to destructure.
- Nothing computed inside JSX: a derived value gets a named const above the return, or moves to the facade or `utils.ts`. Rendering a ready list (`{rows.map((row) => <Row key={row.id} row={row} />)}`) is not computing; filtering, sorting or arithmetic on it is.
- A default prop value is a stable reference. Primitives inline; an object or array default is a module-level const, never a fresh `[]` or `{}` in the signature. A literal default is a new identity on every parent render, so every consumer of that prop re-renders and any memo keyed on it is dead.
- No `render`-prefixed function outside test files; a `renderX` helper is a sub-component.
- An effect syncs React with something outside it. It is idempotent, its dependency list is real, and derived state never lives in one.

## State

- **Each kind of state has one home.** View state a link should reproduce (the revision, the address inside the Brief, the open thread, the conversation filter) lives in URL search params, parsed by the route's `validateSearch` (`features/pulls/search`). Server data lives in the TanStack Query cache behind a `build*QueryOptions` builder. Client state several components share lives in a zustand store; state one component owns is `useState`.
- Focus mode is the one mirror: the Brief view store (`BriefView/store.ts`) owns it, seeded from `focus` only when the screen mounts; state writes the Address's `focus` from it by replace, so Back and Forward within a Brief never change it and a Brief switch starts outside it.
- A value that must survive a reload lives in localStorage only through its own storage module (the seen version in `features/version/utils.ts` is the template: a zod parse on read, a default when the key is absent or storage throws). One the server must render with, because it changes the layout, lives in a cookie the same way, built by `utils/preference-cookie` (`BriefView/diff-view/diff-view-storage.ts` is the template; the Sidebar's `storage.ts` and `reading/story-card-track-storage.ts` follow it).
- A flow whose state is more than two coupled fields is one union-typed field moved only by named pure transitions in `utils.ts` (the review flow's `ComposerState` is the template), never a generic `reduce(state, event)`; an async step carries a token, and its settle applies only while that token is current.
- **State that resets on a Brief switch resets one of three ways**: a per-Brief zustand store a `useCreate*` hook holds in a ref and rebuilds when the Brief id changes (`BriefView/store.ts` is the template; the expansion, reading-position and review-flow stores follow it); a `key` on the Brief id for one region's own state; or a value tagged with its Brief id and compared at read. Never a module singleton, a keyed remount of the whole view, or a render-phase reset.

## Version notice

The version notice is one feature folder (`features/version`): the band under the Header on Home and the brief page, the per-user dismissal, and the Account menu's dismissed row and avatar dot all read one query (`buildVersionQueryOptions` over `GET /api/version`); the menu's row and dot go through `useVersionPresence`. A security release has no dismiss. An API whose `SERVER_VERSION` is `dev` never shows it, and the browser suite's API sets none, so the suite cannot see it.
