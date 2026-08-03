# apps/web — agent notes

The TanStack Start front end: local file-backed Briefs (the demo path) and
the DB-backed read + submit surface (BRIEF-19/21/23). Repo-wide TS rules
live in the root `CLAUDE.md`; feature context lives in `docs/adr/`
(0022/0024) and `docs/plans/`.

## Conventions

- Components take EXPORTED prop interfaces (never inline); heavy components
  get a facade hook that owns their flow state — `useReviewSubmit` is the
  template (the screen wires props in; the hook owns pending/error/copy).
- Server data crosses `data/apiFetch` only (isomorphic: SSR dispatches
  in-process through the SAME authz gate). Never reach persistence from a
  server function — that would be a second enforcement path.
- **A server function's rejection is a client-visible string** (BRIEF-20,
  extending the BRIEF-97 cause-leak rule): TanStack serializes the Error's
  message — and walks non-enumerable own props, so `{ cause }` ships too.
  Every `createServerFn` handler therefore ends at a curation boundary: the
  raw reason is logged server-side (as a FIELD — `msg` bypasses the seam's
  redaction) and replaced with copy from a closed allowlist.
  `features/brief/utils/briefErrors.ts` is the template allowlist;
  `briefHandlers.server.ts` holds the wrapped handler BODIES and
  `brief.functions.ts` stays validators + one-line delegation (a
  `createServerFn` wrapper cannot be invoked without the Start server
  runtime, so logic inline there is logic nothing can test). Two suites pin
  it: `briefHandlers.server.test` drives real failures,
  `briefHandlers.backstop.server.test` mocks the readers into throwing raw
  Node errors — deleting a wrapper fails the latter. Error components render
  a curated mapper (`briefErrorDetail` / `prBriefErrorDetail`), NEVER
  `error.message` — not even an `ApiError`'s, which embeds the request path.
  Node errors are the specific hazard: `readFile` on a missing artifact
  discloses the deployment's absolute paths. Messages that reflect caller
  input (a pasted URL) are curated too — they land in a `role="alert"`.
- Isomorphic and shared client/server modules INJECT their log sink (a narrow
  `{ warn }`/`{ error }` interface the `packages/logging` `Logger` satisfies);
  they never import `server/logger`, which is `server-only`. No sink passed =
  silent, which is the client default: a browser has no operator, so a
  `console.*` nobody reads does not earn its level (ADR 0034 #5). Silence is
  only correct client-side, so EVERY server-side caller must pass one —
  `data/ssrWarnSink`'s `getSsrWarnSink()` is the resolver for call sites that
  run on both sides (queryFns reached by route loaders). Forgetting it is
  silent by construction, so it is a review checkpoint, not a lint error.

## Placement and styling (ADR 0037 — full rules + why live there)

- Every folder answers at a glance: one visible MAIN entry, everything else
  in a visible support category (2026-07-26 owner ruling, supersedes
  flat-by-default). A feature root = `index.tsx` (THE entry: the entry
  component's JSX, or a curated re-export when it has co-located support
  files) + `types.ts` + `components/` / `hooks/` / `utils/` / `server/` /
  topic folders. Inside `components/`, every component nests under its
  owning component. A loose uncategorized file is a defect (except files
  with an explicit in-ADR justification, e.g. `brief/queries.ts`).
- Server-code split: `src/server/` = app-wide infrastructure only (logger,
  webhook composition, health); a feature's server code lives in that
  feature's `server/` (dependency cap — feature knowledge never sits in the
  global layer). The real API surface is `packages/api`; web server functions
  stay the thin demo/SSR residue. Inventory when needed: `**/*.server.ts` +
  `**/*.functions.ts`. TanStack enforces the boundary by file suffix +
  import-protection, not folder location.
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
- Units (BRIEF-84, ADR 0037 amendment): text and everything text-coupled is
  rem via `functions.to-rem(<px>)` — font sizes, margin/padding/gap (raw px
  is stylelint-banned there), touch-target min-heights, measure caps,
  menu/dialog widths; chrome stays px — borders, radii, shadows, icon boxes,
  decorative geometry, breakpoints. Ambiguous sizing → px. Taxonomy:
  `docs/plans/brief-84-px-to-rem.md`.
- `data-testid` for test selection; `data-state`/`data-variant` for styling —
  CSS targets attributes, not toggled classes. Extracted components adopt
  both at birth.

## Async mutations against external systems (BRIEF-23 review loop — enforced)

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
- **Success must persist independent of component lifetime.** A request can
  settle after the provider (and its sessionStorage persistence subscriber)
  unmounted — durable transitions are written directly
  (`markSnapshotCommentsSubmitted`), not only through the live store.
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
  unrecoverable loop. `submitBlockedReason` mirrors the submit route's caps
  and budgets — keep the mirrors in lockstep with
  `packages/api/src/routes/review-submit.ts` when either side changes.

## Test gotchas

- No vitest globals in this repo: `@testing-library/react` does NOT
  auto-cleanup — add `afterEach(cleanup)` or the previous test's DOM leaks
  into the next test's `screen` queries. Component/hook tests need the
  `// @vitest-environment jsdom` pragma.
- Route tests that seed the query cache BYPASS the wire parsers — pair them
  with queryFn-level tests against realistic wire bodies (BRIEF-21 lesson:
  a wrong parser shipped green).

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
