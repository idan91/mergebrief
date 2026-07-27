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

## Placement and styling (ADR 0037 — full rules + why live there)

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
```
