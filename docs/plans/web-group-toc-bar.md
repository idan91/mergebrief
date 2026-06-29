# Right-edge Change-group TOC bar (Notion/dock style)

## Context

The **Story view** pivots the brief by **Change-group** (`StoryView.tsx` maps
`model.groups` → `<section>` per group). There is no fast way to see all groups at a
glance or jump between them; you scroll. This adds a **fixed, right-edge navigation
bar** — one horizontal line per Change-group — with a Notion-style hover callout and
macOS-dock feathered magnification. It is **navigation, not a histogram**.

Reuses existing machinery:

- `useScrollSpy` (`src/hooks/useScrollSpy.ts`) — currently fed chunk ids; promote to
  group-level for the active marker.
- `jumpToChunk` (`BriefPage.tsx:294`) — click a line → `jumpToChunk(group.chunks[0].id)`.
- Category color tokens (same ones the GroupCard / dominant-category dot use).

## Decisions (resolved during grill-with-docs)

| #               | Decision                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit            | **One line per Change-group** (not per chunk — chunks have no standalone name)                                                                                                                                                                                         |
| Scope           | **Story view only** (Concern view pivots by Concern; group-TOC meaningless there)                                                                                                                                                                                      |
| Position        | `position: fixed`, viewport right edge, vertically centered; floats in the gutter, **no layout reflow**. Gutter column deferred — decide after seeing it overlap                                                                                                       |
| Overlap bg      | `background: color-mix(in srgb, var(--bg) 55%, transparent)` + `backdrop-filter: blur(8px)` (frosted glass — content faintly visible, lines stay legible)                                                                                                              |
| Tooltip/callout | Group name (Summary line 1) + dominant-category dot; **ellipsis-truncate**, full text in `title`                                                                                                                                                                       |
| Magnify         | Dock-style feather by **vertical** cursor proximity; grows **width + opacity**, right-anchored (extends into gutter); ~2–3 neighbor falloff                                                                                                                            |
| Resting length  | **Uniform** — no size encoding. Encoding LoC/chunk-count would read as a "size verdict", which `CONTEXT.md` explicitly fights for LoC                                                                                                                                  |
| Active state    | Group-level scroll-spy → **persistent lit line** (full opacity + category color); hover magnification layers on top                                                                                                                                                    |
| Click           | `jumpToChunk(group.chunks[0].id)`                                                                                                                                                                                                                                      |
| a11y            | `<nav aria-label="Change groups">`, each line a `<button>` (group name = accessible label). `prefers-reduced-motion`: drop feather scaling + transitions, keep static lines / instant active highlight / instant callout. Keyboard focus shows the callout, no magnify |

**No ADR** — reversible UI nav widget, unsurprising, no hard trade-off.
**No CONTEXT.md change** — "TOC bar" is a UI component, not domain vocabulary.

## Implementation

New component dir: `src/features/brief/components/GroupTocBar/`

- `GroupTocBar.tsx` — exported prop interface (per component conventions), not inline.
- `GroupTocBar.module.scss` — inside `@layer components`.

### Props

```ts
export interface GroupTocBarProps {
  groups: BriefViewModel["groups"]; // id, summary, dominant category, chunks
  activeGroupId: string | null;
  jumpToGroup: (groupId: string) => void;
}
```

### Behavior

1. **Active group via scroll-spy.** In `BriefScreen`, promote the existing scroll-spy
   to also resolve the active _group_. Either feed group section ids to a second
   `useScrollSpy` call, or derive the active group from `activeChunkId` by mapping the
   chunk → its group in `model`. Prefer deriving from `activeChunkId` (no second
   scroll listener). Gate to `viewMode === "story"`.
2. **Render** `<nav aria-label="Change groups">` of `<button>`s, one per group, fixed
   to the right edge, vertically centered.
3. **Magnification** (decoration only): track pointer Y over the bar; each line's
   scale = falloff(|lineCenterY − pointerY|) over ~2–3 neighbors. Apply to width +
   opacity, right-anchored transform. Use rAF / CSS custom property to avoid layout
   thrash. Clear on pointer-leave.
4. **Callout** on hover/focus: group name (truncated, ellipsis, `title` = full) +
   dominant-category dot. Position next to the hovered line. If it can overflow a
   contained ancestor, portal to `document.body` (same pattern as `DeltaCallout`).
5. **Click / Enter** → `jumpToGroup(groupId)` → `jumpToChunk(group.chunks[0].id)`.
6. **Reduced motion**: `@media (prefers-reduced-motion: reduce)` removes scale +
   transitions; active highlight + callout become instant.

### Wiring

- `BriefPage.tsx` `BriefScreen`: compute `activeGroupId`, add `jumpToGroup`, render
  `<GroupTocBar>` only when `viewMode === "story"`.
- Pass category color the same way GroupCard resolves the dominant-category color.

### Tests

- Extend the characterization suite (`src/characterization/briefScreen.test.tsx`) /
  add `GroupTocBar.test.tsx`: renders one button per group, button label = group name,
  click calls `jumpToGroup` with the right id, active group gets the active class.
  Magnification math is decoration — assert it degrades under reduced-motion rather
  than pixel-testing the feather.

## Risks / watch-outs

- `backdrop-filter` not universally supported → keep the 55% `--bg` fill as graceful
  fallback (still legible, just less frosted).
- Pointer-move magnification must be rAF-throttled; no per-mousemove React state churn
  (drive via a CSS var or transform on refs).
- Don't introduce a second always-on scroll listener if `activeChunkId` already gives
  the group cheaply.

## Git workflow (captured via git-eng)

- **Branch:** `feature/group-toc-bar` (off `main`).
- **Commits:** chunked, sequential — one per logical unit
  (e.g. 1: group-level active-id + `jumpToGroup` wiring; 2: `GroupTocBar` component +
  styles; 3: callout + magnification; 4: a11y / reduced-motion; 5: tests).
- **Pre-commit gate:** run `performance-reviewer` on `git diff --cached` before each
  commit; apply fixes for findings ≥80 confidence and re-run until clean.
- **PR:** push `-u origin HEAD`, open a **ready-for-review** PR targeting `main`.
  Title: `feat: Right-Edge Change-Group TOC Bar`. No AI-attribution trailers/footers.

## Implementation agents

- **git-eng** — branch creation, the chunked commits + performance-review gate, push, PR.
- **typescript-eng** — component/types/hook implementation, prop-interface and SCSS-module
  conventions, TS correctness.
