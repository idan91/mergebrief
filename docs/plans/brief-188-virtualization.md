# BRIEF-188 — virtualize the brief's long lists

Implementation plan. Grill decisions are LOCKED in the BRIEF-188 Notion
ticket (section "Grill decisions", 2026-08-13) — this plan executes them,
it does not reopen them. Builds directly on BRIEF-186's landed constraints
(keep-warm lens panes, in-place brief switch, perf harness).

## Goal

A brief for a big PR (hundreds of chunks) mounts, scrolls, and navigates at
interactive speed by rendering only viewport-adjacent chunk cards. Today
every group, chunk, and diff row mounts on first render and on every
rebuild; the ~700–900ms revision/lens ceiling left by BRIEF-186 is
full-tree reconcile + layout/paint, and it scales with brief size.

## Locked design (summary — full text in ticket)

1. **Layer**: chunk cards windowed within each group, both lens trees
   (StoryView `ChunkCard`, ChangesOnlyView `NarrativeChunkCard`). Group
   sections + GroupCards always mounted. ConcernView out of scope.
2. **Library**: TanStack Virtual `useWindowVirtualizer` — one instance per
   group list, `scrollMargin` = list's document offset with
   ResizeObserver-driven re-measure; absolutely-positioned items inside a
   chunk column sized to `totalSize` (sticky GroupCard tracks column
   height, unaffected).
3. **Anchors**: index-resolver — `chunkId → index → scrollToIndex → await
   mount → settle-correct` — at the choke points (`useChunkScroller`,
   `landOnChunk`/`landOnRow`). `useRevisionNavigation` switches from DOM
   `querySelectorAll` to a model-derived target list (jump-target rows live
   inside DiffTable; DOM enumeration silently skips unmounted chunks).
   Scroll-spy derives the active chunk from virtualizer offsets.
4. **State**: hoist DiffTable's `expandedConversation` into the ephemeral
   flow store keyed by chunk id; drag/railHover stay local. Focus-pin via
   `rangeExtractor`: the chunk holding `document.activeElement` or an open
   composer never unmounts. Scroll restoration lands approximately —
   accepted.
5. **Keep-warm preserved**: virtualizer latches while its pane is frozen
   via `enabled: false` driven by a `[hidden]`-ancestor check — a `frozen`
   prop cannot propagate through the LensPane memo comparator (it skips
   the delivering render).
6. **content-visibility stays** on DiffTable `.viewport`; the `--diff-rows`
   math becomes the shared height model feeding `estimateSize`. Guard
   against cv-reveal ↔ remeasure oscillation.
7. **SSR**: estimate-based initial window — fixed `initialRect` constant +
   deterministic shared `estimateSize`, so server and client render the
   identical offset-0 window (no hydration mismatch). Pre-authorized
   fallback: drop SSR for the brief tree if this fights back.
8. **Done**: see Measurement gates below.

## Git workflow (mandatory — all git operations via the `git-eng` skill)

- Stacked branches off each other, root off `main`:
  `perf/BRIEF-188/<part>`. PR titles `[BRIEF-188] <prefix>: Title Case`.
- Chunked commits per logical unit; **performance-reviewer gate on staged
  changes before every commit** (fix findings ≥80 confidence, re-run until
  clean). No `Co-Authored-By` trailers, no AI-attribution in PR bodies.
- `fable-reviewer` subagent reviews each PR branch before it goes up;
  review-loop iterates on medium+ severity findings, nitpick-only = clean.
  Two review rounds max without a stated reason.
- Idan merges. After each squash-merge, realign the remainder of the stack
  (`rebase --onto` with patch-id proof — the `watch-pr-stack` flow);
  realigns include open review-comment fixes.
- Push via HTTPS + gh helper. Never plain-pull a rebased branch.

## Mandatory skills

- `typescript-eng` — strict TS, no bare `as`, const-map unions, named
  exports, extensionless imports.
- `tdd` — test-first for the resolver, store hoist, latch guard, and
  height model.
- `impeccable` — rendered-UI audit on the two wiring PRs (PR 4, PR 5):
  scroll jank, landing correctness, layout shift, sticky-rail behavior.
  Render and MEASURE before shipping CSS-affecting changes.

## PR stack (5 PRs, sequential, stacked)

All parts: **Fable 5, main session, sequential** — each PR depends on the
previous. Effort per part as noted.

### PR 1 — `perf/BRIEF-188/harness` (~300 LOC, effort: medium)

**Plainly: measure first, change nothing.** Time the slow actions on a
300-chunk and a 600-chunk brief, save today's numbers; every later PR is
judged against them.

- Generate + commit baseline numbers at 12×25 AND 12×50
  (`pnpm -C apps/web perf:fixture -- --groups 12 --chunks-per-group 50`);
  record the pre-virtualization scaling curve in the PR body.
- New spec: `jump-far-chunk` — toc-jump to the far group (the toc lands on
  a group's FIRST chunk by design); records landing time plus landing
  offset, cold and warmed, as `PERF_RESULT` metrics. Recording, not
  asserting: measured 2026-08-13, the cold far jump ALREADY mis-lands today
  (~250–580px — cv estimate drift; remembered sizes make warmed jumps land
  clean), so the in-viewport assert flips on in PR 4 once settle-correction
  exists. The Measurement-gates section holds that obligation.
- New spec: scroll smoke — synthetic fast scroll top→bottom, record p95
  rAF frame gap as a baseline metric (no hard gate yet).
- Reuse `waitForInteractive` hydration gating everywhere (pre-hydration
  clicks are lost or measure MPA reloads); lens flips settle on the
  eyebrow, radios click the label text.

### PR 2 — `perf/BRIEF-188/thread-state-hoist` (~200 LOC, effort: medium)

**Plainly: move one piece of state to safety.** The "thread expanded" flag
lives inside the diff component; virtualization will destroy and recreate
those as you scroll, so the flag moves to the store now. Nothing visible
changes.

- Move `expandedConversation` (inline thread open/closed per line) from
  DiffTable `useState` into the ephemeral flow store, keyed by chunk id;
  resets per brief with the rest of the ephemeral state.
- `dragStart`/`dragCurrent`/`railHover` stay component-local (transient).
- Test: expansion state survives a DiffTable unmount/remount cycle.
- Zero user-visible change; e2e thread-expansion assert rides here and
  keeps passing unchanged.

### PR 3 — `perf/BRIEF-188/window-hook` (~500 LOC, effort: high)

**Plainly: build the engine, plug in nothing.** A hook that answers "which
chunk cards are near the viewport?" — near ones render, far ones don't. It
guesses card heights from row counts, never drops the card being typed in,
and goes dormant when its lens is hidden. Unit-tested, used by nobody yet;
the app looks identical. This PR carries the design risk — take it slowly.

- Add `@tanstack/react-virtual`.
- Extract the DiffTable `--diff-rows` height math into a shared height
  model (one estimator: rows × row-height + head + margins), consumed by
  both `contain-intrinsic-block-size` and `estimateSize`.
- `useGroupWindow` (name per repo idiom) wrapping `useWindowVirtualizer`:
  - `scrollMargin` from the list element's document offset;
    ResizeObserver on preceding content re-measures when offsets shift.
  - `enabled`/latch guard driven by a `[hidden]`-ancestor check (jsdom-safe
    — never `getClientRects`, per BRIEF-186 gotcha).
  - `rangeExtractor` extension pinning the focused/composer chunk index.
  - Fixed `initialRect` constant + deterministic estimate path for SSR.
- Unit tests in jsdom for: latch behavior, pin behavior, estimate
  determinism (server input = client input ⇒ identical window), resolver
  index math. Layout-dependent behavior is covered by the perf specs, not
  jsdom.

### PR 4 — `perf/BRIEF-188/story-virtualize` (~800 LOC, effort: high)

**Plainly: plug the engine into the story lens — the speedup happens
here.** The brief renders ~8 cards instead of 300. Far chunks no longer
exist in the DOM, so everything that jumps to a chunk (toc, conversation
links, scroll highlight) switches from DOM lookup to: ask the engine to
scroll there → wait for the card to appear → finish the jump. Over the
500-LOC ideal because wiring and resolver are inseparable — windowed DOM
without the resolver breaks every jump; justified in the PR body.

- StoryView chunk column → relative box at `totalSize`, absolute
  `ChunkCard` items; group sections, GroupCard, sticky rail, focus mode
  untouched.
- SSR renders the deterministic offset-0 window for this tree (no
  hydration mismatch — e2e console gate proves it).
- Index-resolver helper (`scrollToIndex → await mount → settle-correct`,
  correction only past an offset threshold, no visible double-hop);
  rewire `useChunkScroller`, `landOnChunk`, `landOnRow`.
- Scroll-spy: active chunk from virtualizer offsets (replaces the
  rAF + `getBoundingClientRect` loop).
- cv-oscillation guard: perf spec asserts no cv-reveal ↔ remeasure loop;
  fallback = pin `contain-intrinsic-block-size` post-first-paint.
- `impeccable` audit on the rendered result (scroll, jump, sticky, split
  and single-column modes).

### PR 5 — `perf/BRIEF-188/changes-virtualize` (~500 LOC, effort: high)

**Plainly: same plug-in for the changes lens, plus the leftovers that need
both lenses done.** Revision prev/next jump gets its targets from data
instead of the DOM; prove lens flips keep your position; publish the final
before/after numbers.

- ChangesOnlyView / `NarrativeChunkCard` wiring (same shape as PR 4).
- Keep-warm latch proven end-to-end: lens flip preserves scroll + window
  (e2e assert); frozen pane's virtualizer stays latched, flip-back is
  identical DOM.
- `useRevisionNavigation` → model-derived target list routed through the
  resolver (works for targets in unmounted chunks in either tree); adapt
  `useRevisionNavigation.test.ts`.
- Final numbers: full metric set at 12×25 and 12×50 in the PR body —
  the scale-flatness gate closes here.
- `impeccable` audit; file the keep-warm-deletion follow-up ticket if
  numbers show flips are cheap without it.

## Measurement gates (definition of done)

- **Primary — scale-flatness**: every metric at 12×25 vs 12×50 within
  ~20%. Cost no longer scales with brief size.
- **Secondary — improvement at 12×25**: `revision-nav-*` and
  `lens-to-full` medians ≤ half of the pre-virtualization baseline
  (~720ms / ~919ms). `cold-load-rev1` recorded, not hard-gated (dev-server
  variance dominates).
- **Behavior**: `jump-far-chunk` lands in viewport with ≤1 correction;
  thread expansion survives scroll-away-and-back; lens flip preserves
  scroll + window; e2e console gate stays clean (hydration mismatch,
  dup-key). Scroll restoration lands approximately — known, asserted as
  such.
- Numbers ride in PR bodies; the harness is a convention gate, not CI.

## Known gotchas carried from BRIEF-186

- Perf specs must hydration-gate via `waitForInteractive`; big fixture
  hydrates >20s in dev.
- Lens radios: click the label text; settle flips on the eyebrow.
- Brief queries `staleTime: Infinity` ⇒ rev-nav measures remount cost only.
- Memo freeze does not stop store-subscription re-renders in hidden trees —
  scope any new store selectors.
- jsdom has no layout: `[hidden]`-ancestor checks, never `getClientRects`.
- The `.main` region is pinned to `inline-size: 100%` — do not reintroduce
  shrink-to-fit width tracking.
