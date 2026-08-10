# Phase 1 Brief — Baseline B′: validate http(s) scheme on fulfillment label URLs

**PR:** https://github.com/medusajs/medusa/pull/15605
**Repo:** medusajs/medusa
**Size (git):** 8 files, +77/−17

> **Baseline B′ rendering.** Full brief minus the differentiator layer: NO Category labels, NO playbooks, NO risk-surface. Keeps the grouped substrate — change-groups, core/supporting, concern split, adjusted LoC, descriptive summaries (≈ what Linear Diffs ships for free).
> Generate by copying the filled `medusa-15605.md`, then deleting: Categorization lines, all Playbook sections, the Risk Surface column. Do NOT hand-author separately.

---

## 1. Chunks (grouped)

| Chunk | Concern | Role | Group # | Adjusted LoC |
|---|---|---|---|---|
| `packages/medusa/src/api/utils/common-validators/common.ts` (+20) · (+) 19-38 · (−) — | implementation | core | <from Treatment> | <from Treatment> |
| `packages/medusa/src/api/admin/fulfillments/validators.ts` (+3/−3) · (+) 2, 18-19 · (−) 2, 18-19 | implementation | core | <…> | <…> |
| `packages/medusa/src/api/admin/orders/validators.ts` (+3/−3) · (+) 2, 109-110 · (−) 2, 109-110 | implementation | core | <…> | <…> |
| `packages/admin/dashboard/src/routes/orders/order-detail/components/order-fulfillment-section/order-fulfillment-section.tsx` (+11/−1) · (+) 329-339 · (−) 329 | implementation | core | <…> | <…> |
| `packages/medusa/src/api/utils/common-validators/__tests__/common.spec.ts` (+24) · (+) 1-24 · (−) — | test | supporting | <…> | <…> |
| `integration-tests/modules/__tests__/fulfillment/index.spec.ts` (+8/−8) · (+) 226-227, 256-257, 274-275, 301-302 · (−) 226-227, 256-257, 274-275, 301-302 | test | supporting | <…> | <…> |
| `integration-tests/modules/__tests__/fixtures/fulfillment/index.ts` (+2/−2) · (+) 49-50 · (−) 49-50 | test | supporting | <…> | <…> |
| `.changeset/warm-rockets-laugh.md` (+6) · (+) 1-6 · (−) — | doc | supporting | <…> | <…> |

## 2. Change-groups (Story View — substrate only)

### Group 1: <one-line intent>

**Summary:** <descriptive summary — copied from Treatment>
**Core chunks:** <list>
**Supporting chunks:** <list>
**Adjusted LoC:** +<A>/−<D>

> No Categorization, no Playbook — stripped for B′.

## 3. Concern View (LoC Split)

| Concern | Adjusted LoC |
|---|---|
| implementation | +<TODO>/−<TODO> |
| test | +<TODO>/−<TODO> |
| doc | +<TODO>/−<TODO> |
| spec | +0/−0 |
| config | +0/−0 |
| generated | (collapsed) |
