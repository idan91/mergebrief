# BRIEF-102 — Per-group "changed since <sha>" marker

No grill (ticket fully specified; init-plan only). Picked up 2026-08-03.

## What ships

When a reviewer checkpoint exists, each GroupCard header carries a muted
since-marker: "N files changed since <shortsha>" linking into the delta
lens (Compare = Your last review), or "unchanged since your last review".
The data already exists — lastReview comparison marks; the ticket is
surfacing it where people read.

## Verified facts

- `ComparisonMarks` = `{baselineSha, headSha, baselineLabel, baselineIndex,
  files: RevisionChangeFile[]}`; `RevisionChangeFile` =
  `{file, addedRanges, removedRanges}`. `BriefChunk.file` joins group
  membership to marks files.
- `useComparisonOverlay` fetches marks ONLY for the ACTIVE compare baseline
  (`enabled: planActive`) — the marker needs lastReview marks fetched
  whenever the slot exists, Compare active or not. Same queryKey as the
  active fetch → React Query dedupes.
- Local path resolves sidecar ids via `resolveLocalComparisonIds(compare,
  selectedPoint.comparisons)` — callable with a fixed "last-review" to get
  the marks id independent of the active baseline.
- GroupCard is `memo`ized; BriefView renders WITHOUT a router in
  ownDraftView tests — a `useNavigate` inside the marker broke rendering
  there (discovered at implementation; the original useNavigate plan is
  DEAD). Shipped design: navigation is an injected `openDeltaLens`
  callback, route-owned (DB route memoizes `onNavigateSearch`); the local
  demo path passes no callback and renders the marker as plain text.
- ACCEPTED consequence (review finding): the count is a FILE-level join
  while the lens highlights join per line — a file shared across groups
  can light both group markers even when the changed ranges sit in one
  group's chunks. Locked spec counts distinct member files with nonempty
  marks entries; revisit only if it confuses in real use.

## Implementation (one PR)

Branch `feature/BRIEF-102/group-since-marker` → PR
`[BRIEF-102] feat: Per-Group Changed-Since Marker`, base `main`.
Estimate ~300–400 LOC incl. tests. Steps (TDD):

1. **Pure counting util** (`BriefScreen/utils.ts`):
   `groupSinceMarkers(groups, marks)` → per-group distinct member files
   with a nonempty marks entry. Unit tests first (multi-chunk same file,
   file outside group, empty ranges entry, null marks).
2. **Overlay exposure**: `useComparisonOverlay` adds an always-on (when the
   slot exists) lastReview marks query on BOTH paths (plan slot / local
   sidecar id); exposes `sinceReviewMarks: ComparisonMarks | null`.
3. **Render**: `SinceMarker` component under GroupCard — muted header line;
   changed>0 → button "N files changed since <shortsha>" firing the
   injected `openDeltaLens` (plain text without it); 0 → plain "unchanged
   since your last review". Marker absent when no checkpoint marks.
   Semantic tokens, rem, data-testid.
4. **Wiring**: BriefScreen memoizes the marker map off `sinceReviewMarks` +
   `model.groups`; StoryView passes per-group entries (stable identities —
   ChunkCard/GroupCard memo discipline: derive via useMemo keyed on the
   marks object, which React Query keeps referentially stable).
5. **Tests**: util unit tests; route-level (DB path) test pinning marker
   text + navigation to compare=last-review; no-checkpoint absence case.
   jsdom pragma + afterEach(cleanup).

## Mandates

- git-eng for ALL git ops; chunked commits; security-reviewer +
  performance-reviewer pre-commit gate (findings >=80 fixed before commit);
  no Co-Authored-By, no AI attribution.
- typescript-eng + tdd skills mandatory.
- Verification: apps/web typecheck/test/lint + root `pnpm lint` before push
  (BRIEF-127 lesson: CI Lint = root prettier too), build for SSR safety.
- fable-reviewer branch loop until nitpick-only, then PR + CI watch.

## Execution

Single part, main session.
