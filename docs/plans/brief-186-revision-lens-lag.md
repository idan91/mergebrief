# BRIEF-186 — revision + lens lag: decouple the control from the recompute

Implementation plan. Grill decisions are LOCKED in the BRIEF-186 Notion
ticket ("Grill decisions", 2026-08-12); this plan executes them and does not
reopen them.

## Problem (one paragraph)

Revision navigation pays two serialized costs: a blocking
`useSuspenseQuery` fetch of the selected revision's brief, then a
`key={briefId}` remount of the entire `<BriefView>` subtree
(`PrBriefContent.tsx` — `briefId` is span-derived via `usePrBriefPlans`, so
every revision selection changes the key). Lens (View/Compare) changes never
touch the key — their cost is re-render breadth only, and is unmeasured.
The only existing measurement (51–84ms) is on a two-group fixture that
structurally cannot show the problem.

## Locked decisions this plan executes

1. Revision nav first; lens stays in scope, diagnosed on the fixture.
2. Measurement: synthesized large fixture (hundreds of chunks, scaled from
   the e2e fixture generator) + one real-PR sanity check. Fixture is shared
   with BRIEF-188 (virtualization) — build once.
3. Lever 1 — non-blocking fetch: `startTransition`/placeholder; the stale
   brief stays visible but NOT interactive (dim ~0.6 + `inert` on the
   content region; sticky toolbar stays live, last click wins; indicator
   appears only after 150–200ms and holds ≥200ms; pending cue on the
   revision control; `aria-busy`; no spinner overlay).
4. Lever 2 — remove `key={briefId}`: `MindMapProvider` re-derives the store
   and flushes the snapshot on `briefId` change; enumerate every per-brief
   state that today resets only via unmount; delete the `data-revnav` focus
   capture/restore mechanism.
5. Lens: no pending affordance ever — synchronous recompute; the fix, if
   the fixture shows one is needed, is re-render breadth.

## Git workflow (git-eng — MANDATORY for all git operations)

- All branching, commits, pushes, and PRs go through the `git-eng` skill.
- Stacked branches off `main`, one per PR:
  `perf/BRIEF-186/large-fixture` → `perf/BRIEF-186/revision-transition` →
  `perf/BRIEF-186/drop-brief-key` (→ `perf/BRIEF-186/lens-rerender` if
  PR 4 happens). Each PR's base is the previous branch; retarget to `main`
  as predecessors squash-merge (rebase `--onto`, per the standing
  squash-merge stack workflow).
- Commit strategy (confirmed): agent commits, **chunked** — one commit per
  logical unit; **`performance-reviewer` gate on staged changes before
  every commit** (findings ≥80 confidence get fixed before committing).
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- PR titles: `[BRIEF-186] perf: …` in Title Case, per git-eng rules.
- Each PR gets a `fable-reviewer` subagent review before handing to Idan;
  Idan merges. Review budget: 2 rounds max; medium+ findings iterate,
  nitpick-only = clean.

## Specialist skills (confirmed — MANDATORY during implementation)

- `typescript-eng` — all TS work (strict mode, no `as`, Result at
  boundaries, repo conventions).
- `tdd` — behavior lands test-first where the surface is testable
  (transition state machine, provider re-derive/flush, state-reset
  enumeration pins).
- `impeccable` — lever 1 is a visual PR: audit the rendered pending state
  (and any lens UI touched) in a real browser before handing over. Pairs
  with the standing render-before-shipping-CSS rule: compile, screenshot,
  measure — never ship blind.

## Part / PR breakdown

### PR 1 — synthesized large fixture + measurement harness

Branch `perf/BRIEF-186/large-fixture`. Est. ~350–500 LOC. Model: **Fable 5,
medium effort, main thread** — mechanical scaling of an existing generator
plus a timing harness; no design subtlety.

1. Scale the e2e fixture generator to emit a parameterized large brief
   (target: hundreds of chunks across tens of groups; pick sizes that make
   the lag reproducible, not just measurable).
2. Add a measurement harness (playwright, reusing the BRIEF-185
   render-proof harness recipe) that drives: revision select → time to
   interactive content; lens flip → time to settled frame. Output numbers,
   not vibes.
3. Record BEFORE numbers for revision nav and lens on the large fixture —
   these are the plan's baseline and ride in every later PR body.
4. One sanity check against a real big PR (local, not CI): confirm the
   fixture's lag is the same order of magnitude. Note the result in the PR
   body.
5. Fixture and harness are shared infrastructure for BRIEF-188 — keep them
   free of BRIEF-186-specific assumptions.

### PR 2 — lever 1: non-blocking revision fetch + pending treatment

Branch `perf/BRIEF-186/revision-transition`, base = PR 1. Est. ~400–600
LOC incl. tests + styles. Model: **Fable 5, medium effort, main thread** —
the spec is fully locked; tests + the impeccable audit are the backstop.

1. Wrap revision navigation in `startTransition` (or `placeholderData` on
   the brief query — decide at implementation against how the suspense
   boundary sits; the observable contract is what's locked, not the API).
2. Pending treatment per the locked spec: dim ~0.6 + `inert` on the brief
   content region only; sticky header toolbar stays operable (last click
   wins); 150–200ms appearance delay, ≥200ms minimum hold once shown;
   pending cue on the revision control; `aria-busy` on the content region;
   no spinner overlay. Timing constants live in one place.
3. Tests (tdd): pending-state machine (delay, min-hold, last-click-wins),
   inert blocking interaction, toolbar staying live. jsdom pragma +
   `afterEach(cleanup)` per repo gotchas; timing via fake timers.
4. Impeccable audit on the rendered pending state over the large fixture;
   screenshots in the PR body (orphan-branch hosting recipe from
   BRIEF-185/134 if needed).
5. AFTER numbers for revision nav in the PR body (fetch no longer blocks;
   rebuild cost remains — expected partial win; say so explicitly).

### PR 3 — lever 2: drop the key, explicit per-brief reset

Branch `perf/BRIEF-186/drop-brief-key`, base = PR 2. Est. ~400–700 LOC.
Model: **Fable 5, HIGH effort, main thread** — the state-enumeration is a
completeness problem and the risk center of the whole ticket; the one PR
where high effort earns its cost.

1. Enumerate per-brief state that currently resets ONLY via unmount:
   sweep everything under `<BriefView>` for `useState`/`useRef`/module
   state/context whose lifetime is the mount (scroll positions, open/closed
   UI state, focus, debounced writes, query-cache interactions). Write the
   enumeration INTO the PR body as a checklist — the reviewer's job is to
   falsify its completeness.
2. `MindMapProvider`: re-derive the store and flush the pending snapshot
   write on `briefId` change (hydrate + persist effects are already
   briefId-keyed); remove reliance on unmount for both jobs.
3. Remove `key={briefId}` at `PrBriefContent.tsx`. Decide against the
   enumeration whether `routes/briefs.$briefId.tsx` (local route, key at
   ~line 78) gets the same change or keeps its key — different navigation
   pattern may make its remount harmless; justify either way in the PR.
4. Delete the `data-revnav` focus capture/restore mechanism (exists solely
   because the operated control was destroyed mid-interaction) and its
   exported constant + docs.
5. Tests: every enumerated state gets a reset pin (switch brief → state N
   resets); focus stays on the operated control across revision change
   WITHOUT the hack; snapshot flush on brief switch.
6. AFTER numbers for revision nav (both levers now in) in the PR body.

### PR 4 (conditional) — lens re-render breadth

Branch `perf/BRIEF-186/lens-rerender`, base = PR 3. Opened ONLY if the
fixture still shows lens lag after PR 3. Scope unknown until diagnosed —
budget a diagnosis pass first (React profiler on the fixture), then cut
re-render breadth (memo boundaries, selector granularity, plan recompute
memoization). Model: **Fable 5, medium effort, main thread**; escalate to
high only if the profiler shows something structural. If the fixture
shows lens is fine, close the ticket at PR 3 and note the numbers.

## Invocation

Sequential, main thread, in PR order — each PR depends on the previous
(fixture measures, lever 1 restructures what lever 2 touches). No parallel
subagents for implementation; reviews run as subagents per PR.

## Verification (every PR)

```sh
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web lint
pnpm -C apps/web build
```

Plus: measurement harness numbers in every PR body; impeccable audit on
visual PRs (PR 2, PR 4 if it happens). No generation-surface files are
touched, so the eval harness does not run.
