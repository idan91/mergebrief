# Phase 1 Brief — Baseline B′: add string case conversion utilities

**PR:** https://github.com/better-auth/better-auth/pull/9727
**Repo:** better-auth/better-auth
**Size (git):** 6 files, +125/−17

> **Baseline B′.** Full brief minus the differentiator layer: NO Category labels, NO playbooks, NO risk-surface. Keeps grouped substrate (change-groups, carrier/supporting, concern split, adjusted LoC, summaries). Generate by stripping the filled Treatment brief — do NOT hand-author separately.

---

## 1. Chunks (grouped)

| Chunk | Concern | Role | Group # | Adjusted LoC |
|---|---|---|---|---|
| `packages/core/src/utils/string.ts` (+37) · (+) 4-40 · (−) — | implementation | carrier | 1 | +37/−0 |
| `packages/core/src/utils/string.test.ts` (+77) · (+) 1-77 · (−) — | test | supporting | 1 | +77/−0 |
| `packages/better-auth/src/client/proxy.ts` (+2/−7) · (+) 6, 71 · (−) 70-76 | implementation | carrier | 1 | +2/−7 |
| `packages/better-auth/src/plugins/open-api/generator.ts` (+2/−2) · (+) 7, 430 · (−) 7, 430 | implementation | carrier | 1 | +2/−2 |
| `packages/cli/src/generators/drizzle.ts` (+2/−8) · (+) 2, 11 · (−) 10-17 | implementation | carrier | 1 | +2/−8 |
| `.changeset/string-case-utils.md` (+5) · (+) 1-5 · (−) — | doc | supporting | 1 | +5/−0 |

## 2. Change-groups (Story View — substrate only)

### Group 1: Add shared string case conversion utilities

**Summary:** Added shared Unicode-aware string case conversion helpers and replaced inline case-conversion logic in the client proxy, Drizzle generator, and OpenAPI generator.
**Carrier chunks:** `packages/core/src/utils/string.ts`; `packages/better-auth/src/client/proxy.ts`; `packages/better-auth/src/plugins/open-api/generator.ts`; `packages/cli/src/generators/drizzle.ts`
**Supporting chunks:** `packages/core/src/utils/string.test.ts`; `.changeset/string-case-utils.md`
**Adjusted LoC:** +125/−17

> No Categorization, no Playbook — stripped for B′.

## 3. Concern View (LoC Split)

| Concern | Adjusted LoC |
|---|---|
| implementation | +43/−17 |
| test | +77/−0 |
| doc | +5/−0 |
| spec | +0/−0 |
| config | +0/−0 |
| generated | (collapsed) |
