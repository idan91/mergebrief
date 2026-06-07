# Validation Plan

Phased plan to validate the product hypothesis before committing to architecture. Each phase costs more than the last and is gated on signal from the previous.

The rule: **spend in proportion to remaining risk**.

## Known vs Unknown (entering this plan)

- **Mostly known (A — pain):** Qualitative signal from EM and engineer friends across multiple companies confirms the wedge pain on two axes: (1) blind AI-reliance without genuine review, (2) skill atrophy / engineers losing their technical touch. Sample is small (N=few, peer network) — directional, not conclusive. Broader interviews (`next-steps.md` #1) still earn their place but do not block this plan.
- **Unknown (B — categorizer accuracy):** Can AI reliably tag chunks across frontend / backend / infra with usable accuracy? Foundational — if this fails, brief is noise.
- **Unknown (C — reviewer behavior):** Does presenting intent categories + per-category playbooks actually change reviewer engagement vs raw diff? Could fail even with perfect labels.
- **Unknown (D — data model / persistence / identity):** Architectural unknowns. Matters at scale, not at validation.

## Phase 1 — Wizard-of-Oz C Test

**Goal:** Confirm reviewers behave differently when shown intent categories + per-category playbooks vs raw diff. Kill the wedge fast if it's going to die.

**Method:**
- Hand-label 10–20 real PRs across mixed change types (refactor, lib-bump, schema-change, new-feature, pure-move, etc.).
- For each PR, produce a brief in the format defined in `initial-scope.md`: summary + multi-tag categorization (dominant + secondary) + per-category playbook + risk-surface attributes.
- Present the brief and the PR (in whatever simple UX is fastest — a Notion doc, a Loom walkthrough, a markdown rendering, paper prototype) to 3–5 friendly reviewers.
- Watch behavior. Do they read the playbooks? Use the categories to navigate? Engage differently than they would with raw GitHub diff?
- Compare against a baseline — same reviewers, similar PRs, raw-diff-only.

**Cost:** Hours of labeling + days of observation. No production code.

**Gate:** Behavior visibly moves vs raw-diff baseline. Reviewers spontaneously reach for the structure (not just acknowledge it politely). If they skim past it the same way they skim AI CR comments today → wedge is wrong even with perfect AI. Stop and revisit.

## Phase 2 — Categorizer Benchmark (B)

**Only if Phase 1 passes.**

**Goal:** Confirm AI can produce the categorization at usable accuracy across the change types the product depends on.

**Method:**
- Reuse Phase 1's hand-labeled PRs as the **gold set** — no wasted work.
- Build a categorizer. Test on the gold set + a broader sample of real PRs.
- Metrics to track:
  - Dominant-category agreement with hand labels (suggest target: >80%).
  - Multi-tag overlap (does AI catch the secondary tags humans assign?).
  - Behavior on edge cases — mixed chunks (move + edit), generated code, vendored dependencies.
  - Per-domain breakdown — accuracy on frontend vs backend vs infra (likely uneven; informs which domains v1 launches into).
  - "Uncertain" rate — how often the model can't confidently classify (high uncertain rate is honesty, not failure).
- Optionally run **Phase 1 round 2** in parallel: broader reviewer audience, now with real AI-tagged output (or a mix of real + corrected-by-hand for control).

**Cost:** 2–3 weeks of focused engineering.

**Gate:** Accuracy crosses the threshold *and* Phase 1's behavior signal holds with the broader audience. If accuracy is below threshold → either the model isn't ready or the taxonomy needs rework. If behavior signal drops when AI labels are used (vs hand labels) → AI errors break the wedge experience and need fixing before commit.

## Phase 3 — Architecture & D Commit

**Only if Phase 2 passes.**

**Goal:** Build the product surface that supports the validated wedge at scale.

**Method:**
- Decide the data model and persistence layer (mind-map space per PR × reviewer, brief cache by SHA, receipt aggregation).
- Build the web app shell, GH App, OAuth flow, deep-link bridge.
- Implement the activation gate + debounced delta compute.
- Onboard first paying or POC team.

**Cost:** Weeks-to-months of engineering. Material investment.

**Gate:** This is the commit phase — past this, throwing it away is expensive. Only enter if Phases 1 + 2 have produced unambiguous signal worth the spend.

## Open Items

- Threshold calibration for Phase 2 — is 80% dominant-category agreement the right bar? Depends on per-category baseline difficulty.
- Phase 1 reviewer pool composition — same vs different from Phase 2 audience. Worth considering whether broader Phase 2 audience needs to be net-new (less anchored).
- Recovery move if Phase 1 fails: pivot? Reframe the wedge? Or kill?
- Recovery move if Phase 2 fails: pivot taxonomy? Different model strategy? Fall back to hand-labels as a paid concierge service while the AI catches up?
