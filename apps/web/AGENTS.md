# apps/web — agent notes

The TanStack Start front end: the DB-backed read + submit surface, fed by
`packages/api` for both App-installation and URL-box briefs. Repo-wide TS rules live in the root
`CLAUDE.md`; feature context lives in `docs/adr/` and `docs/plans/`.

## Conventions

- Components take EXPORTED prop interfaces (never inline); heavy components
  get a facade hook that owns their flow state — `useReviewSubmit` is the
  template (the screen wires props in; the hook owns pending/error/copy).
- Server data crosses `data/apiFetch` only (isomorphic: SSR dispatches
  in-process through the SAME authz gate). Never reach persistence from a
  server function — that would be a second enforcement path.
- **Error components render a curated mapper** (`briefErrorDetail` /
  `prBriefErrorDetail`), NEVER `error.message` — not even an `ApiError`'s,
  which embeds the request path. Messages that reflect caller input (a
  pasted URL) are curated too — they land in a `role="alert"`. If a
  `createServerFn` ever returns to this app, its rejection is a
  client-visible string (TanStack serializes the Error's message and walks
  non-enumerable own props, so `{ cause }` ships too) — every handler must
  end at a curation boundary that logs the raw reason server-side as a
  FIELD and throws a CODE from a closed allowlist.
- **User-facing copy lives in the `packages/i18n` catalog, never in a
  component.** Module-local `COPY` maps are dead: a component reads
  `useTranslation()`; a pure helper takes a `TFunction` first parameter; a
  data structure stores a `TranslationKey` and resolves at render (the view
  model stays locale-free). `eslint-plugin-i18next` (`jsx-only`) fails the
  build on JSX text and attributes, but it CANNOT see a string assigned to a
  const or built in a template literal — those are a review checkpoint, and
  the dev-only `pseudo` locale is the runtime detector for anything that
  never reached `t()`.
  Three things stay English on purpose: text written INTO GitHub (the review
  signature, the receipt `<pre>`'s frozen artifact format), repo-authored
  strings passed through verbatim (`criteria`/`implication`), and parse-error
  messages the callers discard. The wire carries a CODE, never a sentence —
  the client renders it from the catalog (`briefErrors.ts` is the URL box's
  mapper), so the cross-boundary check stays an identity test on a stable
  token.
- Isomorphic and shared client/server modules INJECT their log sink (a narrow
  `{ warn }`/`{ error }` interface the `packages/logging` `Logger` satisfies);
  they never import `server/logger`, which is `server-only`. No sink passed =
  silent, which is the client default: a browser has no operator, so a
  `console.*` nobody reads does not earn its level. Silence is
  only correct client-side, so EVERY server-side caller must pass one —
  `data/ssrWarnSink`'s `getSsrWarnSink()` is the resolver for call sites that
  run on both sides (queryFns reached by route loaders). Forgetting it is
  silent by construction, so it is a review checkpoint, not a lint error.

- **The file-backed brief surface is DEVELOPMENT-ONLY.** `/briefs/$briefId`
  (and its summary preview) read artifacts from `MERGEBRIEF_OUT_DIR` —
  absolute, or relative to the checkout root, defaulting to
  `tools/categorizer/out` — and render them with no database and no review
  session, which is why they are read-only. It exists so CLI-generated briefs
  can be opened while iterating; the product path reads rows.
  The boundary is `localBriefsDir()` returning `undefined` under
  `import.meta.env.PROD`, checked inside `requireLocalBriefsDir()` which
  EVERY reader calls before touching the filesystem — so a direct
  server-function call cannot bypass it. The route-level `beforeLoad` guards
  are UX only: they turn the throw into a clean 404. Note the polarity:
  `PROD`, never `!DEV`, because vitest runs in mode `test` and the readers
  must behave there as they do in dev. Brief ids are charset-gated
  (`BRIEF_ID_PATTERN`, no path separators) before being joined, and every
  refusal crosses the wire as a CODE — a raw Node error would print the
  deployment's absolute paths into a `role="alert"`.
- **Decompose at birth, not on review.** Every sub-component gets its own
  nested folder plus `module.scss`; closure-free helpers and consts go to a
  co-located `utils.ts`/`consts.ts`; types to `types.ts`. Prop interfaces are
  exported (`interface XProps`), never inline in the signature. A component
  carrying heavy logic extracts it to a co-located
  `use<Component>Facade` hook and stays thin.
- **Leave vertical rhythm.** Blank line between the hook-setup group, each
  `useEffect` (its comment attached above it), derived values, and JSX
  sections. Related one-liners may sit together.
- **Never gate behaviour on how a visually identical mode was entered.** If two
  states look the same, a behavioural difference between them is
  indistinguishable from a bug. Key behaviour on the visible state, or make the
  modes visibly distinct. When the same defect is reported a third time after
  two verified fixes, question the design rather than the code.
- **Fold capability into the shared component; no behaviour wrappers.** A
  generic capability (positioning, hover, anchoring) belongs in the component's
  own API. `HoverX`/`AnchoredX`/`XWrapper` forks its identity — a wrapper is
  only justified when it encodes a product feature's domain mapping.
- **One `.svg` asset file per mark or icon**, imported via svgr. Never a
  collection of path data grouped into one `.tsx`.

## Placement and styling (full rules + rationale live in `docs/adr/`)

- Every folder answers at a glance: one visible MAIN entry, everything else
  in a visible support category. A feature root = `index.tsx` (THE entry: the entry
  component's JSX, or a curated re-export when it has co-located support
  files) + `types.ts` + `components/` / `hooks/` / `utils/` / `server/` /
  topic folders. Inside `components/`, every component nests under its
  owning component. A loose uncategorized file is a defect (except files
  with an explicit justification in the decision record, e.g.
  `brief/queries.ts`).
- Server-code split: `src/server/` = app-wide infrastructure only (logger,
  webhook composition, health); a feature's server code lives in that
  feature's `server/` (dependency cap — feature knowledge never sits in the
  global layer). The real API surface is `packages/api`; web server code is
  composition + SSR plumbing only, never business logic. Inventory when
  needed: `**/*.server.ts` + `**/*.functions.ts`. TanStack enforces the
  boundary by file suffix + import-protection, not folder location.
- Barrels are entry-level only: feature `index.tsx` + folder `index.ts`
  where it clarifies outside imports; no per-component barrels. Curated —
  NEVER re-export anything touching `server/` (import-protection breaks the
  client build), and for outside consumers only: internal files import
  targets directly, never their own feature's index (import/no-cycle).
- New file placement: co-locate with its single consumer; on a second
  consumer, promote to the nearest common ancestor of all consumers
  (parent component → feature root → global, last resort). Lateral imports
  into another subtree are forbidden — wanting one IS the promotion signal.
  Anything touching a feature's store/queries never sits above that feature.
- In-component functions are closure-dependent only; closure-free logic goes
  to a co-located `<Component>/utils.ts` (directly unit-testable).
- Zero raw colors/font-sizes/radii/shadows in `.module.scss` — semantic-scale
  tokens/mixins only (no value-named tokens); off-scale values stay raw with a
  line-scoped stylelint disable + TODO note, or earn a component-local token
  with a one-line justification.
- Units: text and everything text-coupled is
  rem via `functions.to-rem(<px>)` — font sizes, margin/padding/gap (raw px
  is stylelint-banned there), touch-target min-heights, measure caps,
  menu/dialog widths; chrome stays px — borders, radii, shadows, icon boxes,
  decorative geometry, breakpoints. Ambiguous sizing → px. Taxonomy:
  `docs/plans/brief-84-px-to-rem.md`.
- Heading levels follow document structure, never size: one `h1` per screen
  (a state/error card that replaces the screen owns it), `h2` for a top-level
  section, overlay content rooted at `h2`, no skipped levels. A component that
  wants a different size pins one in its own module; a shared shell styles
  headings level-agnostically so it never dictates a level. Authored markdown
  through `components/Markdown` is exempt — it keeps its fixed h1→h3/h2→h4
  demotion. Reviewer-held: no lint rule expresses it.
- **Styling carries no comments.** A `.module.scss` rule, a token, or a
  `style` object gets a comment ONLY when a reader who understands CSS would
  still be unable to predict the behaviour — a browser bug or missing feature
  (`overflow-clip-margin` is unimplemented in WebKit), a value that must track
  something in another file, a cascade or ordering trap, or a measured
  constraint an innocent edit would silently break (a WCAG target-size gap).
  Everything else goes: no restating the declaration below it (`min-inline-size`
  is self-evidently a floor), no naming the layout mechanism (`display: grid` is
  visible), no design rationale, no history of what was tried. If the comment
  would survive being pasted into another project's stylesheet, it says nothing
  about this one — delete it. Prefer deleting outright over shortening; a
  trimmed paragraph is still a paragraph.

- `data-testid` for test selection; `data-state`/`data-variant` for styling —
  CSS targets attributes, not toggled classes. Extracted components adopt
  both at birth. A behavioral third category (an attribute runtime code
  queries for) is allowed only with an exported constant and its own doc
  comment, never a bare literal, and never doubling as a test or styling
  hook — currently none exist.

## Async mutations against external systems (enforced)

The submit flow earned each of these the hard way; any future mutation
against GitHub (or any external system) follows them:

- **Capture inputs at initiation.** Snapshot the ids/values the request
  ships at click time and, on success, mutate exactly that set — state
  added or edited mid-flight must never be marked as sent.
- **The external write is the commit point.** Once it succeeds, local
  persistence is BEST-EFFORT: log failures and keep the success copy. A
  throw AROUND the write gets INDETERMINATE copy ("may or may not have
  posted — check GitHub") — never "nothing happened", which invites a
  double-posting retry.
- **One in-flight request per draft — a disabled button, not a protocol.**
  The server holds the drafts, so a POSTED one that settles after its mount
  is gone still reconciles: the row flipped server-side and the next read
  carries it. What does not survive is an AMBIGUOUS failure's warning — it
  has no server trace, and a reviewer who left mid-post returns to a
  re-enabled button. That window is accepted, not fixed by a per-tab queue;
  never rebuild one.
- **Result surfaces must outlive the request.** Failure copy also goes
  through a page-level live region (the toast); an inline `role="alert"`
  in a closable drawer is inert by the time a slow response lands. Repeat
  announcements need a DOM change — announce clear-then-set.
- **Server-owned records go read-only locally.** Once posted, a comment's
  text belongs to GitHub: no Edit/Delete in the UI, and the store no-ops
  update/delete on submitted comments (a local edit would silently diverge
  — re-submits ship drafts only). One-shot verdicts are SPENT on success
  (outcome resets to `comment`).
- **Mirror every deterministic API rejection with recoverable copy.** The
  UI resubmits the same state, so an unmirrored deterministic 400 is an
  unrecoverable loop. `submitBlockedReason` mirrors the caps the submit route
  applies to the drafts the session holds (count, path length, the
  degradation fold's budget) — keep it in lockstep with
  `packages/api/src/routes/repos/pr/review/` when either side changes.
- **One operation per user action, and a failure reverts.** Every session
  write is its own request naming its Brief (`?base=&head=`); there is no
  snapshot PUT, no batching, no network debounce and no retry machinery — a
  retry is the action again. A failed write puts the UI back where that same
  action is still available (the checkbox un-ticks, the composer stays open
  holding its text), which is why the composer closes on write SUCCESS
  rather than on click. A `pr-changed-since-read` 409 is terminal for the
  screen, not a per-action failure: it goes read-only behind the revision
  banner, and nothing drafts locally behind it.

## Test gotchas

- No vitest globals in this repo: `@testing-library/react` does NOT
  auto-cleanup — add `afterEach(cleanup)` or the previous test's DOM leaks
  into the next test's `screen` queries. Component/hook tests need the
  `// @vitest-environment jsdom` pragma.
- Route tests that seed the query cache BYPASS the wire parsers — pair them
  with queryFn-level tests against realistic wire bodies — a wrong parser
  can otherwise ship green.

## Verification

```sh
pnpm -C apps/web typecheck
pnpm -C apps/web test      # characterization harness included
pnpm -C apps/web lint      # prettier + stylelint; exit code is the judge
pnpm -C apps/web build     # REQUIRED for isomorphic/server-only changes
```

`build` is not optional paranoia: TanStack Start's `import-protection`
plugin statically denies any CLIENT-graph edge reaching
`@tanstack/react-start/server-only` — including through a dynamic
`import()`, and including edges guarded by an unreachable `typeof window`
branch. typecheck, test, and lint ALL pass on such a graph; only `build`
fails it. Reaching server-only code from an isomorphic module means
`createIsomorphicFn().server(...)` with the import inside the branch
(`data/apiFetch.ts`, `data/ssrWarnSink.ts` are the templates).
