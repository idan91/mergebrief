# apps/web — agent notes

The TanStack Start front end: the DB-backed read + submit surface, fed by `apps/api` for both App-installation and URL-box briefs. Feature context lives in `docs/adr/`.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Conventions

- Components take EXPORTED prop interfaces (never inline); heavy components get a facade hook that owns their flow state — `use<Component>Facade` (e.g. `useGroupCardFacade`) is the template (the screen wires props in; the hook owns pending/error/copy). JSX should move into subcomponents when appropriate; the facade holds store subscriptions, flow actions, and derived selection, not the main file's JSX. Functions and constants inside a facade (or a component) stay there only when they close over its state; anything that can take its inputs as arguments lives in a colocated `utils.ts` / `consts.ts` with a colocated unit test. A facade's return is inferred from the object it returns — never a `*FacadeReturn` type. The hook is wiring, not a deterministic util; a named return type is a second surface to keep in sync.
- Server data crosses `data/apiFetch` only (isomorphic: SSR forwards the viewer's cookie to the API over HTTP, through the SAME authz gate). Never reach persistence from a server function — that would be a second enforcement path.
- **Error components render a curated mapper** (`briefErrorDetail` / `prBriefErrorDetail`), NEVER `error.message` — even an `ApiError`'s embeds the request path. Messages reflecting caller input (a pasted URL) are curated too — they land in a `role="alert"`. A `createServerFn` rejection is a client-visible string (TanStack serializes the message and non-enumerable own props, `{ cause }` included). Every handler therefore ends at a curation boundary: log the raw reason server-side as a FIELD, throw a CODE from a closed allowlist.
- Copy: every `.ts` and `.tsx` literal that is sentence-shaped or Capitalised lives in the `packages/i18n` catalog; the copy lint holds it in `all` mode. A component reads `useTranslation()`; a pure helper takes a `TFunction` first parameter; a data structure stores a `TranslationKey` and resolves at render. The wire carries a code, never a sentence.
- Plurals go through `_one`/`_other` keys with `count`, never a hand-built `"s"`.
- Two files are exempt by shape: the receipt (`features/review/utils/receipt.ts`, text written into GitHub in a frozen format) and head meta (`routes/__root.tsx`). Repo-authored strings passed through verbatim (`criteria`/`implication`) stay English too.
- Isomorphic and shared client/server modules INJECT their log sink (a narrow `{ warn }`/`{ error }` interface `packages/logging`'s `Logger` satisfies); they never import `server/logger` (`server-only`). No sink = silent, which is correct client-side only (a browser has no operator). EVERY server-side caller passes one; `data/ssrWarnSink`'s `getSsrWarnSink()` is the resolver for call sites that run on both sides. Forgetting it is silent by construction — a review checkpoint, not a lint error.
- **Hoist singleton accessors** (`getServerLogger()` and kin): assign once at module scope — or once per composition function — and use the const at every call site. Deferring construction is only justified when the accessor cannot do its own env lookup internally (the `ssrWarnSink` isomorphic path stays lazy by design).
- Composition root: `src/server/env.ts` is the one `process.env` reader, and `src/server/logger.ts` and `src/server/api/transport.ts` are the sanctioned process singletons built from it. This tier holds NO credentials and no database: `/api/*` is proxied to the API process, and SSR reaches it through the same transport so a render meets the same authorization the browser would.

- **The file-backed brief surface (`/briefs/$briefId`) is DEVELOPMENT-ONLY and slated for deletion** (`tools/ingest-briefs` is its cutover); the product path reads rows. `localBriefsDir()` returns `undefined` under `import.meta.env.PROD` — polarity `PROD`, never `!DEV`, because vitest runs in mode `test` — and EVERY reader calls `requireLocalBriefsDir()` before touching the filesystem (route-level `beforeLoad` guards are UX only). Every reader also runs behind `localBriefSessionGate` in `brief.functions.ts`: the API's `GET /api/auth/session` answers, a 401 crosses as `unauthenticated`, anything else fails closed, and the web tier validates no cookie itself. Brief ids are charset-gated (`BRIEF_ID_PATTERN`, no path separators) before joining. Every refusal crosses the wire as a CODE (a raw Node error would print absolute paths into a `role="alert"`).
- **Decompose at birth, not on review.** Every sub-component gets its own nested folder plus `module.scss`; closure-free helpers and consts go to a co-located `utils.ts`/`consts.ts`. Prop interfaces are exported (`interface XProps`), declared in the component file, never inline in the signature. A `types.ts` is for non-prop types a file would otherwise grow: shared unions, maps several files need, or a discriminated prop shape that depends on a base type. Do not open `types.ts` for a single `XProps`. A component carrying heavy logic extracts it to a co-located `use<Component>Facade` hook and stays thin.
- **Never gate behaviour on how a visually identical mode was entered.** If two states look the same, a behavioural difference between them is indistinguishable from a bug. Key behaviour on the visible state, or make the modes visibly distinct. When the same defect is reported a third time after two verified fixes, question the design rather than the code.
- **Fold capability into the shared component; no behaviour wrappers.** A generic capability (positioning, hover, anchoring) belongs in the component's own API. `HoverX`/`AnchoredX`/`XWrapper` forks its identity — a wrapper is only justified when it encodes a product feature's domain mapping.
- **One `.svg` asset file per mark or icon**, imported via svgr. Never a collection of path data grouped into one `.tsx`.
- **Every interactive change declares its accessibility contract** — where focus lands, how async outcomes are announced, targets ≥ 24px — before review, not during.
- **Client code may `console.error` on unexpected failure**; the user sees the failure via UI state, never a raw message.

## Hooks and JSX

- Memoize (`useMemo`, `useCallback`, `memo`) only for a measured cost or a contract-visible need such as a stable dependency a child effect keys on.
- No spread inside JSX, except a primitive forwarding its rest props to its own DOM element, or a floating-ui prop bundle (`getReferenceProps`, `getFloatingProps`, `getItemProps`) onto the element floating-ui positions or the primitive that forwards it: that bundle is the library's contract and has no stable member list to destructure.
- Nothing computed inside JSX: a derived value gets a named const above the return, or moves to the facade or `utils.ts`.
- A default prop value is a stable reference. Primitives inline; an object or array default is a module-level const, never a fresh `[]` or `{}` in the signature. A literal default is a new identity on every parent render, so every consumer of that prop re-renders and any memo keyed on it is dead.
- No `render`-prefixed function outside test files; a `renderX` helper is a sub-component.
- An effect syncs React with something outside it. It is idempotent, its dependency list is real, and derived state never lives in one.

## Placement and styling (full rules + rationale live in `docs/adr/`)

- Every folder answers at a glance: one visible MAIN entry, everything else in a visible support category. A feature root = `index.tsx` (THE entry — the component's JSX, or a curated re-export when it has co-located support files), plus `types.ts` and `components/` / `hooks/` / `utils/` / `server/` / topic folders. Inside `components/`, every component nests under its owning component. A loose uncategorized file is a defect (except files with an explicit justification in the decision record, e.g. `brief/queries.ts`).
- Server-code split: `src/server/` = app-wide infrastructure only (logger, API transport, health); a feature's server code lives in that feature's `server/` (dependency cap — feature knowledge never sits in the global layer). The real API surface is `apps/api`; web server code is composition + SSR plumbing only, never business logic. Inventory when needed: `**/*.server.ts` + `**/*.functions.ts`. TanStack enforces the boundary by file suffix + import-protection, not folder location.
- A feature is imported through its `index.tsx` or one segment below it (`features/brief/utils`); internal files import targets directly, never their own feature's index. A barrel never re-exports anything touching `server/` (import-protection breaks the client build).
- The global `src/components`, `src/hooks`, `src/utils`, `src/data` and `src/test` folders never import `src/features`; `src/routes` may import feature indexes. Wanting a deeper import is the promotion signal: co-locate with the single consumer, and on a second consumer promote to the nearest common ancestor (parent component, feature root, then global). Cross-feature fixtures live in `src/test`. Anything touching a feature's store or queries never sits above that feature.
- In-component functions are closure-dependent only; closure-free logic goes to a co-located `<Component>/utils.ts` (directly unit-testable).
- Zero raw colors/font-sizes/radii/shadows in `.module.scss` — semantic-scale tokens/mixins only (no value-named tokens); off-scale values stay raw with a line-scoped stylelint disable + TODO note, or earn a component-local token with a one-line justification.
- Units: text and everything text-coupled is rem via `functions.to-rem(<px>)` — font sizes, margin/padding/gap (raw px is stylelint-banned there), touch-target min-heights, measure caps, menu/dialog widths. Chrome stays px: borders, radii, shadows, icon boxes, decorative geometry, breakpoints. Ambiguous sizing → px.
- Heading levels follow document structure, never size: one `h1` per screen (a state/error card that replaces the screen owns it), `h2` for a top-level section, overlay content rooted at `h2`, no skipped levels. A component that wants a different size pins one in its own module; a shared shell styles headings level-agnostically so it never dictates a level. Authored markdown through `components/Markdown` is exempt — it keeps its fixed h1→h3/h2→h4 demotion. Reviewer-held: no lint rule expresses it.
- **Styling carries no comments.** A `.module.scss` rule, a token, or a `style` object gets a comment ONLY when a reader who understands CSS could not predict the behaviour: a browser bug or missing feature, a value that must track another file, a cascade trap, or a measured constraint an innocent edit would silently break. Everything else goes — no restating the declaration, no naming the visible layout mechanism, no design rationale, no history. A comment that would survive pasting into another project's stylesheet says nothing about this one; delete rather than shorten.

- `data-testid` for test selection; `data-state`/`data-variant` for styling. CSS targets attributes, not toggled classes. Extracted components adopt both at birth. A behavioral third category (an attribute runtime code queries for) needs an exported constant and its own doc comment, never a bare literal, never doubling as a test or styling hook. One exists: `data-line-origin`, written by `DiffRows` and read through the selectors in `components/DiffRows/consts.ts`.

## Async mutations against external systems (enforced)

Every mutation against GitHub (or any external system) follows these:

- **Capture inputs at initiation.** Snapshot the ids/values the request ships at click time and, on success, mutate exactly that set — state added or edited mid-flight must never be marked as sent.
- **The external write is the commit point.** Once it succeeds, local persistence is BEST-EFFORT: log failures and keep the success copy. A throw AROUND the write gets INDETERMINATE copy ("may or may not have posted — check GitHub") — never "nothing happened", which invites a double-posting retry.
- **One in-flight request per draft — a disabled button, not a protocol.** The server holds the drafts, so a POSTED one settling after unmount still reconciles on the next read. An AMBIGUOUS failure's warning has no server trace and does not survive leaving mid-post; that window is accepted — never rebuild a per-tab queue.
- **Result surfaces must outlive the request.** Failure copy also goes through a page-level live region (the toast); an inline `role="alert"` in a closable drawer is inert by the time a slow response lands. Repeat announcements need a DOM change — announce clear-then-set.
- **Server-owned records go read-only locally.** Once posted, a comment's text belongs to GitHub: no Edit/Delete in the UI, and the store no-ops update/delete on submitted comments (a local edit would silently diverge — re-submits ship drafts only). One-shot verdicts are SPENT on success (outcome resets to `comment`).
- **Mirror every deterministic API rejection with recoverable copy.** The UI resubmits the same state, so an unmirrored deterministic 400 is an unrecoverable loop. `submitBlockedReason` mirrors the caps the submit route applies to the drafts the session holds (count, path length, the degradation fold's budget) — keep it in lockstep with `apps/api/src/routes/repos/pr/review/` when either side changes.
- **One operation per user action, and a failure reverts.** Every session write is its own request naming its Brief (`?base=&head=`); there is no snapshot PUT, no batching, no network debounce and no retry machinery — a retry is the action again. A failed write puts the UI back where that same action is still available: the checkbox un-ticks, the composer stays open holding its text. That is why the composer closes on write SUCCESS rather than on click. A `pr-changed-since-read` 409 is terminal for the screen, not a per-action failure: it goes read-only behind the revision banner, and nothing drafts locally behind it.

## Test gotchas

- No vitest globals in this repo: `@testing-library/react` does NOT auto-cleanup — add `afterEach(cleanup)` or the previous test's DOM leaks into the next test's `screen` queries. Component/hook tests need the `// @vitest-environment jsdom` pragma.
- Route tests that seed the query cache BYPASS the wire parsers — pair them with queryFn-level tests against realistic wire bodies — a wrong parser can otherwise ship green.

## Verification

```sh
pnpm -C apps/web typecheck
pnpm -C apps/web test      # characterization harness included
pnpm -C apps/web lint      # stylelint (prettier rides repo-root pnpm lint);
                           # exit code is the judge
pnpm -C apps/web build     # REQUIRED for isomorphic/server-only changes
```

`build` is required because TanStack Start's `import-protection` plugin statically denies any CLIENT-graph edge reaching `@tanstack/react-start/server-only` — dynamic `import()` and unreachable `typeof window` branches included — and ONLY `build` fails such a graph (typecheck, test, and lint all pass it). Reach server-only code from an isomorphic module via `createIsomorphicFn().server(...)` with the import inside the branch (`data/apiFetch.ts`, `data/ssrWarnSink.ts` are the templates).
