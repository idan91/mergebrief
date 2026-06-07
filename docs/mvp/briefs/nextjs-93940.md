# Phase 1 Brief: Fix cross-param leak with `prefetch={true}` and `cachedNavigations`

**PR:** https://github.com/vercel/next.js/pull/93940
**Repo:** vercel/next.js
**Author:** unstubbable
**Size (git):** 6 files, +165/−32

> Labeling instructions (full process in `labeling-workflow.md`):
> 1. **Inventory** — verify the suggested Concern + Role for each chunk (Concern derived from path; Role derived from Concern: `implementation` → carrier, else → supporting). Override where wrong.
> 2. **Group** — cluster chunks into Change-groups using the boundary rule: one group = the largest chunk set expressible as ONE Summary + ONE Dominant Category. Assign each chunk a Group #.
> 3. For each group: write the **Summary** (descriptive *what*, not narrative *why*), the **Categorization** (dominant + secondary), and copy the **Playbook** items for the dominant Category from `../playbooks.md`.
> 4. **Weighted LoC** — fill per chunk: `+added/−deleted` excluding moved & generated lines; note moves as `moved N`, generated as collapsed.
> 5. **Concern view** — roll up weighted LoC per Concern.
> 6. **Tricky-Cases Note** — pre-register hard cases BEFORE any reviewer session. Freeze once written.
> 7. Delete this instruction block when done.

---

## 1. Chunk Inventory

Verify suggested Concern/Role. Assign each chunk to a Change-group (Group # — you define groups in section 2).

| Chunk | Suggested Concern | Suggested Role | Group # | Weighted LoC | Risk Surface |
|---|---|---|---|---|---|
| `packages/next/src/client/components/segment-cache/cache.ts` (+24/−10) | implementation | carrier | <TODO> | <TODO> | <TODO> |
| `test/e2e/app-dir/segment-cache/cached-navigations/app/with-fallback-params/[slug]/layout.tsx` (−22, deleted) | test | supporting | <TODO> | <TODO> | <TODO> |
| `test/e2e/app-dir/segment-cache/cached-navigations/app/with-fallback-params/layout.tsx` (+51, added) | test | supporting | <TODO> | <TODO> | <TODO> |
| `test/e2e/app-dir/segment-cache/cached-navigations/app/with-fallback-params/page.tsx` (+3) | test | supporting | <TODO> | <TODO> | <TODO> |
| `test/e2e/app-dir/segment-cache/cached-navigations/cached-navigations.test.ts` (+54) | test | supporting | <TODO> | <TODO> | <TODO> |
| `test/e2e/app-dir/segment-cache/cached-navigations/components/link-accordion.tsx` (+33) | test | supporting | <TODO> | <TODO> | <TODO> |

> The two `layout.tsx` rows (deleted in `[slug]/`, added at parent path) are the candidate `move-with-edits`. Inspect by content — what was moved (→ `moved N`, excluded from +/−) vs what was edited inside the move (→ counts as weighted LoC).

## 2. Change-groups (Story View)

> Define one block per group. Most likely this PR is a single group (one intent: fix the leak) — but verify against the boundary rule. If a chunk doesn't fit any group's single-summary test, that's a finding for `## Labeling Scratch`.

### Group 1: <one-line intent>

**Categorization:** dominant: `<TODO>` · secondary: [`<TODO>`]
**Summary:** <one descriptive sentence — what these chunks do, not why>
**Carrier chunks:** <list>
**Supporting chunks:** <list>
**Attention-weighted LoC:** +<A>/−<D> (moved <M>, generated <G> excluded)

**Playbook (dominant Category — copy verbatim from `../playbooks.md`):**
- [ ] <item>
- [ ] ...

### Group 2: <only if the boundary rule splits the PR>

<same structure, or delete if single-group>

## 3. Concern View (LoC Split)

Roll up attention-weighted LoC across all chunks by Concern.

| Concern | Weighted LoC | Notes |
|---|---|---|
| implementation | +<TODO>/−<TODO> | |
| test | +<TODO>/−<TODO> | |
| doc | +0/−0 | |
| spec | +0/−0 | |
| config | +0/−0 | |
| generated | (collapsed) | excluded from split by default |

## 4. Tricky-Cases Note

> Pre-registered hard cases for the Phase 1 success metric. Write BEFORE any reviewer session. Freeze once written. Each must be a concrete observable claim a reviewer's comment can hit or miss.

1. <e.g., "The deleted `[slug]/layout.tsx` and added `with-fallback-params/layout.tsx` are a move-with-edits, not independent delete+add. A reviewer who treats them separately misses the edits hidden in the move.">
2. <...>

## Labeling Scratch

> Anything that didn't fit cleanly — taxonomy gaps, chunks that resist a single group, Concern/Role overrides and why, author-framing divergences. Feeds Phase 2.

- <notes>
