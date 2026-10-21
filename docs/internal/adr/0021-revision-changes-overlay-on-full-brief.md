# 0021: Revision-Changes Overlay on the Full Brief

Status: superseded in part by 0024

The full **Brief** gains an on-by-default **Revision changes** overlay: a *shared*, *per-revision* (`prevHead→head`) marking of which lines are new in this revision, computed **mechanically** from a tree diff — not the per-reviewer **Delta Brief**. The marks are always available from a cheap new sidecar; a richer hover/focus callout (change-group + summary) is **opportunistic**, shown only when a shared `(prevHead, head)` Delta core already exists, and degrades to "summary unavailable" otherwise (amended, see Amendments). It is additive to ADR 0019: the separate per-reviewer Delta lens is untouched.

## Context

ADR 0019 deliberately split the **Full** lens (shared, whole-PR, base→head) from the **Delta** lens (per-reviewer, checkpoint→head) so a reviewer never confuses "the whole PR" with "what changed for me." But a reviewer reading the *Full* brief still wants to see, in place, **what moved in the latest revision** without leaving for the Delta lens — a wayfinding signal on the shared artifact ("the PR advanced; here's where"). That is a *different* question from the Delta Brief's "what changed since **I** last looked": this one is shared and per-revision, not personal and per-checkpoint.

The request originally assumed (a) the overlay would require generating "a delta with every brief," (b) the baseline was "the previous full brief," and (c) blue line-fills with a hover callout. Grilling reframed all three. A Brief is shared/per-head; a Delta is per-reviewer-baseline (0..N per head) — they are not 1:1, so "a delta per brief" is a category error. The marking needs only *which head lines changed since the previous head*, which is a mechanical git tree diff, not an LLM call. And ADR 0008 already models a **shared Delta core** keyed `(baselineSHA, headSHA)` plus a thin per-reviewer carry-over overlay — so the "shared narrative for a revision" is just that core with `baselineSHA = prevHead`, *not* a new artifact type.

## Considered Options

- **Overlay vs merge.** *Merge* Full and Delta into one combined re-review view vs *overlay* delta info onto the Full lens while keeping the Delta lens separate. **Overlay (chosen)** — merging throws away ADR 0019's deliberate separation and reintroduces the "new-to-the-PR vs new-to-me" confusion; the overlay is purely additive.
- **Overlay baseline.** *Per-reviewer* `checkpoint→head` vs *shared* `prevHead→head` vs *selectable*. **Shared `prevHead→head` (chosen)** — keeps the Full brief fully shared and cacheable, and the per-reviewer "since I looked" question is *already* served by the Delta lens, so duplicating it on the Full brief is redundant. A selectable baseline is a clean future lever (consistent with ADR 0019 baseline selection) but is deferred.
- **Mechanism.** *Commit replay over the range* vs *two-endpoint tree diff*. **Tree diff (chosen)** — mirrors ADR 0006 #5: commit-walk breaks under rebase/force-push (intermediate commits may be GC'd) and produces false positives for changed-then-reverted lines, which net-identical endpoints correctly show as unchanged.
- **Marks data source / generation tier.** *Mandatory shared core per head* (generate a `(prevHead,head)` narrative every time) vs *mechanical-only* vs *mechanical marks + opportunistic callout*. **Two-tier (chosen)** — marks ride a cheap mechanical `prevHead..head` sidecar (no LLM, robust in the huge-span fallback and mid-review); the callout reuses a shared core *if it already exists* but is never generated solely for the overlay. Mandatory generation mostly re-describes lines the full brief already groups (double-summary confusion) and spends LLM where the cheap diff suffices.
- **Visual treatment.** *Blue line-fill* vs *gutter rail* vs *surrounding outline box* vs *hybrid*. **Hybrid (chosen)**: a focusable gutter **rail** (one `<button>` per contiguous run) + a soft left-edge tint + a non-color "new" tag, plus **jump-to-next/prev** navigation between runs. Line-fill rejected — it collides with the existing green/red add/del backgrounds, is color-only (WCAG 1.4.1), and offers no keyboard/touch target. Outline-box rejected as the primary channel — table-cell borders are fragile under virtualization and break when a run is split by a deletion or nested.
- **Callout interaction.** *Hover-only* vs *hover + focus + click*. **Hover + focus + click, Esc-dismiss (chosen)** — hover-only fails keyboard/touch and WCAG 2.2 AA 1.4.13, to which ADR 0019 already commits.

## Decision

1. **Revision changes** is a shared, per-revision overlay on the full **Brief**, baseline `prevHead→head` (the immediately previous briefed head). It is never reviewer-relative and is never called a "delta"; the per-reviewer **Delta Brief** lens (ADR 0019) is unchanged.
2. **Marks are mechanical and always available.** A new sidecar emits `prevHead..head` changed-line ranges per file (a plain git tree diff, no LLM), keyed by head and shared. The Full route loads it alongside the brief. Identification joins on the **head line number** (both diffs end at head).
3. **The callout is opportunistic** (amended, see Amendments). When a shared `(prevHead, head)` Delta core (ADR 0008) already exists, the run's hover/focus/click callout surfaces its change-group title + summary; otherwise it reads "new this revision — summary unavailable for this span." No core is generated solely to feed the overlay.
4. **Rendering = Option 4 hybrid**: gutter rail (focusable, one per contiguous run) + soft left-edge tint + non-color "new" tag; callout on hover + focus + click, Esc-dismiss; **jump-to-next/prev** run navigation with a run count. WCAG 2.2 AA.
5. **Toggle** defaults **on** when revision changes exist, is persisted per user, and is **hidden on the first Brief** (no previous head). (Amended, see Amendments.)
6. **Deletions.** Modifications (del+add) are covered via the added side's normal marks. Standalone deletions present at PR base get the rail (matched on the old side, accepting a non-head-line join). The between-lines caret for added-then-removed lines (no row at head) is **deferred to v2**.
7. **Deferred:** a selectable overlay baseline (`prevHead→head` vs `checkpoint→head`), and the added-then-removed deletion caret.

## Why This Way

The overlay answers a genuinely distinct, *shared* question — "what moved in this push" — that the per-reviewer Delta lens does not, so it is additive rather than a replacement, and keeping the baseline shared (`prevHead→head`) keeps the Full brief a single cacheable artifact. Splitting the marks (mechanical, always) from the callout (LLM, opportunistic) is the crux: it makes the blue highlight free and robust precisely in the cases where it earns the most — the 95%-mechanical refactor and mid-review follow-ups, where the LLM delta is skipped or absent — while still enriching the hover when a shared core happens to be warm. The hybrid rail keeps the new "new-this-revision" axis on a separate channel from green/red so the two never fight, and the jump-nav turns "scroll-hunt the diff" into "tap through the N runs," which is the actual re-review payoff on large PRs.

## Consequences

- **One new mechanical artifact**, not an LLM change: the worker writes `comparison_marks` rows keyed `(baseline_sha, head_sha)` (`packages/persistence/src/schema/comparison-marks.ts`), the `prevHead..head` changed-line ranges per head. Full-brief LLM generation is untouched.
- **Read model**: the Full route loads the marks beside the brief; production follows ADR 0008's fetch shape, with the marks as a small shared, span-keyed blob.
- **Reuses, not extends, ADR 0008**: the opportunistic callout consumes the existing shared Delta core at `(prevHead, head)`; the per-reviewer carry-over overlay is not involved.
- **Glossary**: `CONTEXT.md` gains the **Revision changes** term, explicitly contrasted with **Delta Brief** and reserving "delta" for the per-reviewer artifact.
- **Local-first (ADR 0019 #8)**: the demo emits the `prevHead..head` sidecar rather than leaning on the coincidence that the demo's delta artifact spans consecutive heads — keeping the local surface faithful to the shared/per-revision production semantics.
- **FE owns the rendering**: rail/tint/tag, the focusable per-run callout, run-jump navigation, the persisted toggle, and the head-line join; virtualization must preserve rail and run continuity.
- **Deferred levers** (selectable baseline, deletion caret) are reversible additions that do not change this artifact model.

## Amendments

### 2026-07-01: Revision narrative and the Compare control

Superseded in part by ADR 0024: the mechanical **Revision changes** overlay still works as described here, but (a) generated callout summaries are no longer merely opportunistic: non-first Briefs now get a shared **Revision narrative** for `prevHead→head`; and (b) decision 5's toggle is replaced by ADR 0024's **Compare** control, which changes the default (first-time reviewers default to `Compare: Off`, not on-by-default) and the persistence model.
