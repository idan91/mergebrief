# Virtualize `DiffTable` rendering via `content-visibility`

## Context

`DiffTable` renders every diff line as a `<tr>` with no windowing. On load, **all
carrier chunks are expanded by default** (`BriefPage.tsx:167-173` seeds `openChunks`
with every carrier chunk), so a brief with many files mounts dozens of `DiffTable`s
at once — each a few hundred `<tr>`s. The bottleneck is the **aggregate layout/paint
of many simultaneously-expanded moderate diffs**, not one giant diff (real chunks are
a few hundred lines max). Goal: cut off-screen render cost with the smallest, lowest-
risk change, keeping all existing behavior and tests intact.

## Why not row-level virtualization (react-virtual)

For this workload it's the wrong tool: flattening the heterogeneous row list,
swapping `<table>`→grid, per-row measurement, and one window-virtualizer per expanded
chunk — lots of complexity that only pays off for a single huge chunk, which doesn't
occur here. Chunk-granularity skipping is simpler and a bigger win. (Keep react-virtual
noted as a deferred fallback only if a pathological multi-thousand-line single chunk
ever appears.)

## Decision (resolved during grilling)

- **Scope:** target the aggregate of many moderate, simultaneously-expanded diffs —
  not one giant diff, not the chunk-list metadata.
- **Strategy:** **CSS `content-visibility: auto`** per `DiffTable`. Browser skips
  style/layout/paint for off-screen diffs; near-zero JS; `<table>` markup, anchoring
  (`createCommentAnchor`/`rangeBetween`, index-based & DOM-free), drag-select, and the
  characterization suite all stay untouched.
- **Fixed-callout caveat — already handled:** `content-visibility` implies
  `contain: paint`, which would re-base a `position: fixed` descendant. `DeltaCallout`
  already renders via `createPortal(..., document.body)` (`Callout.tsx:13-22`), so it's
  outside the contained subtree and unaffected. No portal work needed.

## Recommended approach

1. **Wrap the table** in `DiffTable.tsx`: put a `<div className={styles.viewport}>`
   around the `<table className={styles.diff}>`. Leave the `{railHover && <DeltaCallout/>}`
   sibling as-is (it portals out regardless).
2. **CSS** (`DiffTable.module.scss`, inside `@layer components`):
   ```scss
   .viewport {
     content-visibility: auto;
     // `auto` remembers real painted size; estimate only tames first-paint scroll jump
     contain-intrinsic-block-size: auto calc(var(--diff-rows, 40) * 22px);
   }
   ```
   Row height ≈ 22px (mono 12.5px × 1.7 line-height). The `auto` keyword self-corrects
   once painted, so comment rows / hunk-row height differences don't matter.
3. **Data-driven estimate:** on the wrapper, set
   `style={{ "--diff-rows": chunk.diff.length }}` so each diff reserves roughly its real
   height before first paint (prevents scrollbar thrash with many off-screen diffs).
4. **Graceful degradation:** browsers without `content-visibility` (Safari < 18,
   Firefox < 125) ignore the property and render as today — acceptable for this tool.

Files: `apps/web/src/features/brief/components/DiffTable/DiffTable.tsx`,
`apps/web/src/features/brief/components/DiffTable/DiffTable.module.scss`.
No new dependency. ~15 lines total.

## Implementation workflow (git-eng)

Drive all git ops through the **git-eng** skill. Decisions (resolved with user):
- **Branch:** `feature/diff-content-visibility`, off `main`.
- **Commits — chunked**, two logical units:
  1. `perf(web): skip off-screen diff render with content-visibility` — add the
     `.viewport` wrapper (DiffTable.tsx) + `content-visibility`/intrinsic-size CSS.
  2. `perf(web): size diff viewport from row count to avoid scroll jump` — wire the
     data-driven `--diff-rows` estimate.
- **Pre-commit review gate:** run **`performance-reviewer`** on the staged diff before
  *each* commit. If it returns findings ≥80 confidence, fix, re-stage, re-run until
  clean, then commit.
- **No `Co-Authored-By` trailers. No AI-attribution lines in commits or PR body.**
- **PR — push and open ready-for-review** against `main`: title `perf: …` per git-eng
  rules; fill `.github/pull_request_template.md` if present, else Overview / Changelog /
  Images; attach before/after brief screenshots.

## TypeScript / code standards (typescript-eng)

- Strict types, **no `any`**, no `as` casts without an upstream type guard.
- Keep the existing **exported `DiffTableProps` interface** pattern; named exports only.
- Reuse the repo's `as const` + `ValueOf<T>` convention already in `types.ts` — no enums.
- The CSS var passes through inline style typed as `React.CSSProperties` with a custom
  property key (`{ ["--diff-rows"]: chunk.diff.length }`) — no `any`.
- After edits: `pnpm --dir apps/web typecheck` + `pnpm --dir apps/web test` must pass;
  `prettier --check` on changed files; stylelint clean on the changed `.module.scss`.

## Verification

- **Confirm the bottleneck first** (cheap, before/after): open a large multi-file brief
  (`/briefs/Idan91-code-review-5_1_10f4acc2`), DevTools Performance panel → record a
  scroll/reload; compare Layout + Paint time and "Rendering" with vs without the change.
  Also eyeball with `Rendering → "Show content-visibility containers"`.
- **Behavior unchanged:** `pnpm --dir apps/web typecheck`,
  `pnpm --dir apps/web test` (characterization suite `briefScreen.test.tsx` green).
- **Manual:** drag-select a comment range, open the composer, hover the revision rail
  (callout still positions correctly), and jump-to-chunk via the timeline / `#chunkId`
  anchor — all still work with off-screen diffs skipped.
- **Visual:** `playwright-cli` before/after screenshots of the brief screen with the
  revision overlay on — no visible difference expected.

## Follow-up

- Update `todo.md`: replace the react-virtual-centric virtualization entry with this
  content-visibility approach; keep react-virtual as a one-line deferred fallback.
