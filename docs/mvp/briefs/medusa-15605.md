# Phase 1 Brief: validate http(s) scheme on fulfillment label URLs

**PR:** https://github.com/medusajs/medusa/pull/15605
**Repo:** medusajs/medusa
**Size (git):** 8 files, +77/−17

> What it does (plain): only accept `http:`/`https:` URLs for the `tracking_url` and `label_url` fields on fulfillment labels, via a shared `safeHttpUrl` zod refinement wired into the admin endpoints. Empty strings and the `"#"` placeholder stay accepted.

> Labeling instructions (full process in `labeling-workflow.md`):
> 1. **Read the diff cold** (`gh pr diff 15605 --repo medusajs/medusa`) before the PR description.
> 2. **Inventory** — verify suggested Concern + Role per chunk; fill weighted LoC.
> 3. **Group** — boundary rule: one group = ONE Summary + ONE Dominant Category.
> 4. Per group: **Summary** (what not why), **Categorization** (dominant + secondary), **Playbook** from `../playbooks.md`.
> 5. **Concern view** — roll up weighted LoC.
> 6. **Tricky-Cases Note** — pre-register, freeze.
> 7. Generate `medusa-15605.baseline.md` (B′) by stripping Category/playbooks/risk-surface.
> 8. Delete this instruction block when done.

---

## 1. Chunk Inventory

| Chunk | Suggested Concern | Suggested Role | Group # | Weighted LoC | Risk Surface |
|---|---|---|---|---|---|
| `packages/medusa/src/api/utils/common-validators/common.ts` (+20) · (+) 19-38 · (−) — | implementation | carrier | <TODO> | <TODO> | <TODO> |
| `packages/medusa/src/api/admin/fulfillments/validators.ts` (+3/−3) · (+) 2, 18-19 · (−) 2, 18-19 | implementation | carrier | <TODO> | <TODO> | <TODO> |
| `packages/medusa/src/api/admin/orders/validators.ts` (+3/−3) · (+) 2, 109-110 · (−) 2, 109-110 | implementation | carrier | <TODO> | <TODO> | <TODO> |
| `packages/admin/dashboard/src/routes/orders/order-detail/components/order-fulfillment-section/order-fulfillment-section.tsx` (+11/−1) · (+) 329-339 · (−) 329 | implementation | carrier | <TODO> | <TODO> | <TODO> |
| `packages/medusa/src/api/utils/common-validators/__tests__/common.spec.ts` (+24) · (+) 1-24 · (−) — | test | supporting | <TODO> | <TODO> | <TODO> |
| `integration-tests/modules/__tests__/fulfillment/index.spec.ts` (+8/−8) · (+) 226-227, 256-257, 274-275, 301-302 · (−) 226-227, 256-257, 274-275, 301-302 | test | supporting | <TODO> | <TODO> | <TODO> |
| `integration-tests/modules/__tests__/fixtures/fulfillment/index.ts` (+2/−2) · (+) 49-50 · (−) 49-50 | test | supporting | <TODO> | <TODO> | <TODO> |
| `.changeset/warm-rockets-laugh.md` (+6) · (+) 1-6 · (−) — | doc | supporting | <TODO> | <TODO> | <TODO> |

> No moves here — straightforward additions/edits. Weighted LoC ≈ git LoC for this PR (nothing to exclude). A clean first case to calibrate on before tackling move-heavy PRs.

## 2. Change-groups (Story View)

> Likely a **single group** — one intent: enforce http(s) on the fulfillment/label URL fields. Verify against the boundary rule.

### Group 1: <one-line intent>

**Categorization:** dominant: `<TODO>` · secondary: [`<TODO>`]
**Summary:** <one descriptive sentence — what changed, not why>
**Carrier chunks:** <list>
**Supporting chunks:** <list>
**Attention-weighted LoC:** +<A>/−<D>

**Playbook (copy verbatim from `../playbooks.md` for the dominant Category + supporting-Concern checks):**
- [ ] <item>

> If `new-feature` is the dominant Category and it's not yet in `playbooks.md`, draft its playbook now (or note it in Labeling Scratch). This is expected — the playbook library expands opportunistically.

### Group 2: <only if the boundary rule splits the PR>

<delete if single-group>

## 3. Concern View (LoC Split)

| Concern | Weighted LoC | Notes |
|---|---|---|
| implementation | +<TODO>/−<TODO> | validator + 2 call sites + FE adoption |
| test | +<TODO>/−<TODO> | unit + integration + fixtures |
| doc | +<TODO>/−<TODO> | changeset |
| spec | +0/−0 | |
| config | +0/−0 | |
| generated | (collapsed) | |

## 4. Tricky-Cases Note

> Pre-register BEFORE any reviewer session. Freeze once written. Each = a concrete observable claim a reviewer's comment can hit or miss.

1. <e.g., "The refinement still accepts empty string and the `\"#\"` placeholder — a reviewer should confirm these carve-outs are intentional AND covered by a test, not silently rejected.">
2. <e.g., "`safeHttpUrl` must be applied to every URL field across BOTH the fulfillments and orders validators — a reviewer should confirm no call site was missed.">
3. <e.g., "Does the unit test actually assert rejection of dangerous schemes (`javascript:`, `ftp:`) — not just acceptance of valid ones? A test that only checks the happy path is vacuous here.">

## Labeling Scratch

> Taxonomy gaps, chunks resisting a single group, Concern/Role overrides + why, author-framing divergences. Feeds Phase 2.

- <notes>
- Note the framing tension: is this `new-feature` (added validation capability) or `bugfix`/security-hardening (URLs were previously unvalidated)? Record your call + reasoning — this is a legitimate categorization judgment and a good inter-rater test point.
