# Phase 1 Brief — Baseline B′: Fix cross-param leak with `prefetch={true}` and `cachedNavigations`

**PR:** https://github.com/vercel/next.js/pull/93940
**Repo:** vercel/next.js
**Author:** unstubbable
**Size (git):** 6 files, +165/−32

> **Baseline B′ rendering.** This is the full brief with the differentiator layer stripped: NO Category labels, NO playbooks, NO risk-surface attributes. It keeps the grouped substrate — change-groups, carrier/supporting, concern split, weighted LoC, descriptive summaries — i.e. roughly what Linear Diffs ships for free.
> Generate this by copying the filled `nextjs-93940.md`, then deleting: Categorization lines, all Playbook sections, and the Risk Surface column. Do NOT hand-author separately.
> The Treatment condition = this + {taxonomy + playbooks + risk-surface}. The within-subject test measures the gap.

---

## 1. Chunks (grouped)

| Chunk | Concern | Role | Group # | Weighted LoC |
|---|---|---|---|---|
| `packages/next/src/client/components/segment-cache/cache.ts` (+24/−10) · (+) 2597-2614, 2629, 2632, 2658, 2661, 2684-2685 · (−) 2611-2612, 2615, 2641-2642, 2645, 2667-2668, 2670-2671 | implementation | carrier | <from Treatment> | <from Treatment> |
| `.../with-fallback-params/[slug]/layout.tsx` (−22, deleted) · (+) — · (−) 1-22 | test | supporting | <…> | <…> |
| `.../with-fallback-params/layout.tsx` (+51, added) · (+) 1-51 · (−) — | test | supporting | <…> | <…> |
| `.../with-fallback-params/page.tsx` (+3) · (+) 1-3 · (−) — | test | supporting | <…> | <…> |
| `.../cached-navigations.test.ts` (+54) · (+) 938-991 · (−) — | test | supporting | <…> | <…> |
| `.../components/link-accordion.tsx` (+33) · (+) 1-33 · (−) — | test | supporting | <…> | <…> |

## 2. Change-groups (Story View — substrate only)

### Group 1: <one-line intent>

**Summary:** <descriptive summary — copied from Treatment>
**Carrier chunks:** <list>
**Supporting chunks:** <list>
**Attention-weighted LoC:** +<A>/−<D> (moved <M>, generated <G> excluded)

> No Categorization, no Playbook — stripped for B′.

## 3. Concern View (LoC Split)

| Concern | Weighted LoC |
|---|---|
| implementation | +<TODO>/−<TODO> |
| test | +<TODO>/−<TODO> |
| doc | +0/−0 |
| spec | +0/−0 |
| config | +0/−0 |
| generated | (collapsed) |
