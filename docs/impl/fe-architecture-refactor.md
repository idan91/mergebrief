# Implementation Plan — `apps/web` Frontend Architecture Refactor

Deepening refactor of `apps/web`, surfaced by an architecture review. The pure-logic
layer (`viewModel`, `timeline`, `revisionChanges`, `reviewComments`, `review/state`,
`validation`) is already deep and tested and is **left untouched**. The work targets the
two shallow giants: `routes/briefs.$briefId.tsx` (2,927 lines, ~30 components, a 25-`useState`
god-container) and `styles/app.scss` (2,605-line flat global stylesheet).

Design decisions for the keystone (Candidate A) are recorded in **ADR 0022**. This plan is
the execution order.

> **Process mandate:** all git operations and the implementation itself are driven through
> the **`git-eng`** skill — branch management, chunked commits, the pre-commit review gate
> (`performance-reviewer`, and `security-reviewer` where relevant), and PR creation. No
> direct git outside `git-eng`. Branch: `feature/imrpove-fe-code`.

## Principles (apply to every slice)

- **Generic vs feature split.** Domain-free, reusable UI → `src/components/<Name>/`. Feature
  UI → `features/<feature>/components/<Name>/`. The existing `Callout` (generic) /
  `DeltaCallout` (feature) pair is the reference.
- **Hooks & styles are global-only at `src/`.** `src/hooks/` holds *only* generic hooks
  (`useLocalPreference`, `useScrollSpy`). Component/page-specific facade hooks colocate with
  their component (e.g. `CommentComposer/useCommentComposer.ts`). `src/styles/` holds *only*
  global tokens; component styles are colocated `*.module.scss`.
- **Utils by cohesion, not count.** Genuinely generic primitives group into small cohesive
  modules (`src/lib/collections.ts` for `toggleSet`/`rangeBetween`) — never one-file-per-function,
  never a single `utils.ts` junk drawer. Domain helpers (`briefMetaLine`, `summarizeProgress`,
  …) move into their feature module, not a utils file.
- **Test colocation** stays as-is (`.test.ts` beside source).
- **Session vs UI vs preference vs derived** is the sorting rule (see Slice A).

## Verification strategy (cross-cutting)

The screen has **no component/integration tests today**, so "behaves identically" needs a real
net — store unit tests alone don't prove the *screen* still works.

- **Floor, every slice:** `pnpm --dir apps/web typecheck` + `prettier --check` + `vitest run`
  all green. CI (`webapp-ci`) enforces the same per commit.
- **Store unit tests (Slice A):** the session store exercised headless — every action +
  transition, hydrate/serialize round-trip. Primary new test surface.
- **Receipt unit tests (Slice E):** `buildReceipt` asserted on structured output (verbatim
  dismissal reason, counts, evidence resolution).
- **Screen characterization net:** add `@testing-library/react` + `jsdom` (test-only deps,
  currently absent). Set the environment **per-file** (`// @vitest-environment jsdom` at the top
  of the component test) — **not** globally, so the existing pure-Node suites are untouched.
  **Harness** (the hard part): the screen reads its **Brief** via a server function that reads
  disk, which doesn't exist under jsdom — so the test must (a) render the real route component
  (in Slice A that is **`BriefApp`/`BriefRoute`**, *not* `BriefPage`, which doesn't exist until
  Slice B), (b) wrap it in `QueryClientProvider` with the client **pre-seeded** (`setQueryData`)
  for `localBriefQueryOptions(fixtureId)` + `localRevisionChangesQueryOptions(fixtureId)` from a
  committed JSON fixture (or mock `brief.functions`), plus the router context and
  `MindMapProvider`, and (c) resolve Suspense. Assert the critical couplings end-to-end:
  groups render; disposing a flag moves the receipt counts; marking a carrier chunk reviewed
  updates progress; reclassifying a group resets its playbook checks. **Written in Slice A
  against the pre-split screen** so it stays green across Slice B's extraction — it is the guard
  that B didn't change behavior. Building the harness (seed + providers) is itself a Slice A task,
  not an afterthought.
- **Manual smoke:** SSR-render the demo brief route, confirm no console errors + key elements
  (rail, toggle, jump-nav, receipt) — the check used during the overlay work.
- **Per-slice exit gate:** floor green + relevant unit tests + characterization suite green +
  manual smoke. A slice isn't done until all pass.

## Sequence

`A → B → E → C → D`. A is the keystone (it collapses B's prop drill); E can run parallel to
B; C is independent; D mostly merges *into* B (styles move per-component as B extracts them),
leaving only a tokens extraction standalone.

---

## Slice A — Mind-Map Session store (keystone)

Per **ADR 0022**. Give the **Mind-Map Space** a real client runtime. Lives in
`features/review/session/` (the Mind-Map Space is review-domain, not brief-rendering).

### Concrete types

```ts
// session/disposition.ts
export type Disposition =
  | { kind: "open" }
  | { kind: "addressed"; evidence?: RiskEvidence }  // evidence OPTIONAL — "addressed,
                                                     // pending evidence" stays a real state
                                                     // (still yields a missing-evidence item)
  | { kind: "dismissed"; reason: string };
```

```ts
// session/store.ts — session state = the Mind-Map Space runtime
export interface MindMapState {
  dispositions: Record<string, Disposition>;        // key = brief-local flag.id
                                                     // TODO(adr-0022): → region@SHA
  dominants: Record<string, Category>;              // groupId → dominant Category
  reclassifiedGroups: Set<string>;                  // groupIds reclassified by reviewer
  reviewedChunks: Set<string>;                      // chunkIds
  checkedItems: Record<CheckBucket, Set<number>>;   // playbook progress
  reviewComments: ReviewComment[];                  // draft + submitted
  reviewOutcome: ReviewOutcome;
}

export interface MindMapActions {
  reviewChunk(chunkId: string): void;                    // toggle membership (see collapse note)
  // open/dismissed share one payload across the batch — genuinely bulk:
  disposeFlag(flagIds: string[], d: { kind: "open" } | { kind: "dismissed"; reason: string }): void;
  // addressed derives evidence PER flag (e.g. chunk-reviewed → each flag's own chunkId),
  // so it needs a resolver, not one shared value (see briefs.$briefId.tsx:751–758):
  addressFlags(flagIds: string[], evidenceFor: (flagId: string) => RiskEvidence): void;
  reclassifyGroup(groupId: string, category: Category): void; // sets dominant, marks
                                                     // reclassified, resets checkedItems[`carrier:${groupId}`]
  checkPlaybookItem(bucket: CheckBucket, index: number): void; // toggle
  saveComment(c: ReviewComment): void;
  updateComment(id: string, body: string): void;
  deleteComment(id: string): void;
  setOutcome(o: ReviewOutcome): void;
}
```

> **Why two flag actions, not one `disposeFlag(ids, disposition)`:** the address-with-evidence
> path resolves evidence per flag, so a single shared `{ kind: "addressed", evidence }` for a
> batch would be lossy. `open`/`dismissed` carry a shared payload and stay bulk; `addressFlags`
> takes a per-flag resolver. Both still write the same `Disposition` union into the map.

**Initial state** (derived from `brief`/`model`): `dispositions = { [flag.id]: { kind: "open" } }`
for `model.flags`; `dominants = { [group.id]: group.group.dominantCategory }`; rest empty;
`reviewOutcome = "comment"`. A persisted snapshot, when present, overrides these.

**Provider + hooks** (zustand vanilla store created per brief, provided via context — never a
module singleton):

```ts
<MindMapProvider brief={brief} model={model} snapshot={snapshot}>…</MindMapProvider>
export function useMindMap<T>(selector: (s: MindMapState & { actions: MindMapActions }) => T): T;
export function useMindMapActions(): MindMapActions;
```

### Persistence (fold `demoState` in)

One effect subscribes to the store and writes a per-brief snapshot to `sessionStorage`
(key `code-review:session:v2`, ~250ms debounce, existing `MAX_SNAPSHOTS` cap); hydrate on store
creation. Snapshot serializes Sets to arrays:

```ts
interface SessionSnapshot {
  briefId: string;
  dispositions: Record<string, Disposition>;
  dominants: Record<string, Category>;
  reclassifiedGroupIds: string[];
  reviewedChunkIds: string[];
  checkedItems: Record<CheckBucket, number[]>;
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
}
```

This persists **more** than today's `DemoReviewSnapshot` (dominants, reclassifications, playbook
checks now survive refresh — they didn't) and **drops** `reviewMode` (now local UI). The `v2`
key avoids colliding with the old `v1` snapshots. This snapshot is also the frozen input to
`buildReceipt` (Slice E).

**SSR guard:** the store hydrates from `sessionStorage`, which does not exist during server
render. Store creation must read storage **client-side only** (lazy init in an effect, or a
guarded `typeof window` read that returns the derived initial state on the server and hydrates
on mount) — the same discipline as the per-brief-not-singleton rule, applied to the read.

**Removal touches `__root.tsx`:** `DemoReviewSnapshotProvider` is currently mounted at the root
wrapping `<Outlet />`. Folding `demoState` in means deleting `demoState.tsx` **and** removing
that root provider; the per-brief `MindMapProvider` replaces it, mounted around the brief screen
subtree.

### Behavior to preserve exactly (migration notes)

- `disposeFlag(ids, { kind: "dismissed" | "open" })` carries no evidence by construction — the
  union makes today's manual evidence-deletion implicit. `addressFlags` writes per-flag evidence.
- `addressed` **without** evidence stays valid → still produces a `missing-evidence`
  `UnresolvedItem`.
- `reclassifyGroup` resets **only** `carrier:${groupId}` checks (matches current `chooseDominant`).
- Both flag actions are **atomic** over the batch (one update), not N sequential.
- `selectedRiskFlags` is **not** in the store — it's local UI; the component clears its own
  selection after calling a flag action.
- **`reviewChunk` → collapse coupling spans the store/local boundary.** Today `markReviewed`
  toggles `reviewedChunks` **and** removes the chunk from `openChunks` (collapse-on-review,
  `briefs.$briefId.tsx:390–397`). After the split, `reviewChunk` is a pure store toggle; the
  **component handler must also drop the chunk from local `openChunks`** or the collapse
  regresses. This is the one coupling that crosses the new boundary — wire it explicitly.
- **`state.ts` adaptation:** `deriveUnresolvedItems` / `riskDispositionCounts` today read
  `Record<string, FlagState>` + `Record<string, RiskEvidence>`. Refactor them to read
  `Record<string, Disposition>` directly (cleaner than an adapter) and update their existing
  tests. This is the one piece of *tested pure logic* the union touches — do it deliberately.

### Sorting the rest of `BriefApp`

Transient UI → local `useState` (`openChunks`, `selectedRiskFlags`, modal-open flags, `toast`,
`activeCommentAnchor`, `dismiss*`, `evidence*`, `reviewMode`). **Persisted** view prefs
(`revisionEnabled`, `viewMode`, `layoutMode`, `collapseSupporting`) → Slice C `useLocalPreference`
(stub inline until C lands). `activeChunkId` is **not** a preference and **not** pure scroll-spy:
it is local state written from *two* sources — the scroll effect (`useScrollSpy`) **and** explicit
nav (`toggleChunk`, `jumpToChunk`, lines 367/387/402). Model it as local state seeded by
`useScrollSpy(ids)` but also settable on click/jump. Derived (`timeline`, `model`, revision counts,
progress, `unresolvedItems`) → `useMemo`/selectors, never stored.

### Internal order (A is the riskiest slice — sub-commit in this order)

1. Add `zustand` (**pin** the version, per the repo's dep-pinning rule). Add test-only
   `@testing-library/react` + `jsdom`.
2. Build the **characterization harness + suite** against the *current* `BriefApp` (seed query
   client with the fixture, wrap providers, resolve Suspense) — green *before* any refactor, so
   it captures today's behavior as the baseline.
3. `session/` store + provider + hooks + headless store tests (additive; `BriefApp` untouched).
4. Refactor `state.ts` to consume `Disposition`; update its tests.
5. Rewire `BriefApp` onto the store; sort the remaining state; wire the `reviewChunk` collapse
   coupling and the per-flag selection clearing in the component.
6. Fold in persistence; delete `demoState.tsx`; remove the root provider in `__root.tsx`.
7. Re-run the characterization suite — it must stay green (the proof of "identical").

### Tests (the payoff)

Store headless unit tests: disposition transitions incl. bulk `addressFlags` per-flag evidence;
reclassify-resets-checks; reviewed toggle; outcome; snapshot hydrate/serialize round-trip. Plus
the **screen characterization suite** (see Verification strategy), written at step 2.

Exit: `BriefApp` no longer owns session state; store + `state.ts` green under unit tests;
characterization suite + manual smoke confirm behavior is identical **except the intentional
persistence-coverage changes** (dominants/reclassifications/playbook checks now survive refresh;
`reviewMode` no longer persists).

## Slice B — Route → thin page + component tree

1. Route `briefs.$briefId.tsx` → loader + suspense + `<BriefPage>` only.
2. Lift each component to its own folder with colocated test (and colocated `*.module.scss`,
   see Slice D):
   - `features/brief/components/`: `BriefPage`, `StoryView`, `GroupCard`, `ChunkCard`,
     `DiffTable` (+`RevisionGutterCell`), `ConcernView`, `Header`, `TimelineNavigator`.
   - `features/review/components/`: `CommentComposer` (+ colocated `useCommentComposer`
     facade hook for the markdown/imperative logic), `CommentThread`, `ReceiptDrawer`,
     `SummaryPreview` (moved here), `DismissModal`, `EvidenceModal`, `PreSubmitModal`.
3. Extract generic shells to `src/components/`. **Real ≥2-use interfaces** (justified by the
   two-adapter rule): `Modal` (3 modals), `Drawer` (2 drawers), `Markdown` (5+ sites:
   `briefs.$briefId.tsx` 608/624/996/1703/1993 + the two `ReactMarkdown` wrappers).
   **Single-use, extract by convention only** (one site today — `Toast`, `Switch` at line 1112):
   promote if it reads cleaner, but don't claim an interface that isn't there. Feature components
   supply only content.
4. Move the inline pure helpers: domain ones (`briefMetaLine`, `artifactHeaderLabel`,
   `summarizeProgress`) into their feature module; generic ones (`toggleSet`, `rangeBetween`)
   into `src/lib/collections.ts`.
5. Children read the store via selectors — the 28–30-prop drill collapses.

Exit: route file ≈40 lines; each component independently renderable + test-colocated.

## Slice E — Receipt builder (parallel to B)

1. `features/review/receipt.ts`: pure `buildReceipt(snapshot, brief, model): Receipt`. Input is
   the **frozen session snapshot** (Slice A's persisted shape), not the live store. Mode-agnostic.
2. `Receipt` is a **structured value** (not a string): `subject`, `progress`,
   `dispositions { addressed[], dismissed[], open[] }`, `comments[]`, `reclassifiedCount`,
   `notChecked[]` (builder constant). No invented "mechanical verified" buckets — model only
   real data, same defer-don't-fake discipline as ADR 0022. Compose existing helpers
   (`riskDispositionCounts`, `evidenceTextForFlag`).
3. Two consumers render the same value differently: `ReceiptDrawer` formats its terminal-style
   `<pre>`; `SummaryPreview` renders its card layout.
4. **Tests:** dismissed disposition carries its reason verbatim; counts; evidence resolution;
   reclassification count. (ADR 0002: receipt content, not a rendered string.)

Exit: receipt content is unit-tested; both consumers read `buildReceipt`.

## Slice C — DOM escape-hatches → adapters

1. `src/hooks/useLocalPreference(key, default)` — generic, SSR-safe (default on server,
   hydrate on client). Absorbs `revisionEnabled`, `viewMode`, `layoutMode`, `collapseSupporting`.
2. `src/hooks/useScrollSpy(ids)` — generic, returns the scroll-active id. In `BriefPage`,
   `activeChunkId` is local state **seeded by** `useScrollSpy(chunkIds)` but **also set
   explicitly** on `toggleChunk`/`jumpToChunk` (it has two write sources — see Slice A sorting),
   so `useScrollSpy` feeds it rather than wholly owning it.
3. `useRevisionNavigation()` → `{ jumpNext, jumpPrev }` — **feature-specific** (knows
   `.railbtn`/revision-run markup), colocated in `features/brief/` next to `BriefPage`/`StoryView`,
   **not** `src/hooks/`. Keep it DOM-driven (positions live in the DOM); it becomes the single
   place coupled to `.railbtn`.
4. Tests: `useLocalPreference` (read/write/SSR default) and `useScrollSpy` where practical.

Exit: no raw `localStorage`/`querySelector`/`getBoundingClientRect` in components; the imperative
logic has named, contained homes.

## Slice D — CSS modules + global tokens

Mostly absorbed by Slice B (each component's styles move to a colocated `*.module.scss` as it is
extracted). Standalone residue only:

1. Lift the `:root` block into a **global, non-module** `styles/tokens.scss` (CSS custom
   properties — runtime cascade), loaded once at the root. Component modules reference
   `var(--token)` with **no import**.
2. A small global base for genuinely non-component styles (resets, `body`, `.scrim`, base
   `.btn`).
3. **Not** a `.module.scss` for tokens — modules hash/scope class names; tokens must stay
   global and unhashed. A Sass `@use` partial is introduced only if/when mixins or compile-time
   math are needed.

Exit: `app.scss` reduced to tokens + a small global base; all component styles colocated and
scoped.

## Out of scope / deferred

- **Region-anchored Dispositions** (ADR 0022 / ADR 0007) — keyed by brief-local id until
  push→regenerate + persistence (ADR 0008) land. `TODO(adr-0022)` marks the boundary.
- **Mechanical "verified / not-checked" Receipt buckets** beyond the current static list — no
  data behind them yet.
- **SSR on/off** is a separate, independent decision; this refactor keeps `ssr: true`.
