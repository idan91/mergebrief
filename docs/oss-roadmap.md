# OSS Roadmap & Prioritized Next Steps

> **Status doc — read first each session.** Tracks the prioritized work for the OSS-only
> direction. Update the status boxes as items move. Created 2026-06-30.

## Context (why this doc exists)

The project is now **OSS-only** — no hosted product, no commercial/SaaS arm. Two drivers:

1. **Founder constraints.** Hosted data-liability and contractual publishing constraints are
   the real blockers (a non-hosted OSS side project is the safe shape; details in private
   project notes).
2. **CodeRabbit shipped our wedge.** "CodeRabbit Review" (a.k.a. **Atlas**, "the first
   AI-native code review interface") reorganizes a PR into semantic **cohorts** + dependency-
   ordered **layers** with per-range AI summaries, diagrams, snapshot/out-of-date deltas, no
   prescriptive verdict, posting back to GitHub natively. That is ~our whole Analysis +
   Engagement wedge, built by a funded team. Competing commercially is dead.
   - Sources: <https://www.coderabbit.ai/blog/introducing-atlas-the-first-ai-native-code-review-interface>,
     <https://www.coderabbit.ai/blog/coderabbit-review-reads-a-pr-how-author-would-explain-it>

**Goal now:** a high-quality OSS project — good word-of-mouth, something good engineers
self-host and use, that builds Idan's personal brand. Not unicorn-hunting.

### What this reframes

- The competitive frame collapses in our favor *because* we went OSS-only — we no longer
  out-feature a funded SaaS for the same buyers.
- **The wedge is now:** open, self-hostable, BYOK, no per-seat cost, no telemetry, hackable,
  good taste (the Sentry / Cal.com pattern). Honest mitigation against a free, funded
  competitor is **not** feature parity — it's a clean, opinionated, trustworthy, self-hostable
  tool.
- **What CodeRabbit did NOT ship (our remaining edge):** stable *cross-PR* taxonomy (theirs is
  PR-local cohorts), a per-category **playbook** library, and anything **open / self-hostable**.
- **What CodeRabbit DID ship that we parked:** the **narrative / dependency-ordered reading
  layer**. They shipped narrative *without* a stable taxonomy underneath. The differentiated
  version is **narrative-on-top-of-taxonomy** (see P2).

### Dead weight (do not let these drive sessions)

The commercial strategy corpus now assumes a product that won't exist: moat / data-exhaust,
open-core split, hosted arm, headless-API-as-distribution, validation Phases 1–3 with reviewer
recruiting. To be archived in P0. Also: do **not** chase CodeRabbit's arms race (semantic /
code graph, generated diagrams, LanceDB-scale search).

---

## Prioritized next steps

Sequence: **P0 → P1 → P2 → P3 → P4**. (P5 = deferred/dropped.)

### P0 — Reframe docs to OSS-only  ·  status: [x] done (2026-06-30)

**Needs grilling:** No (done). · **Docs:** [`vision.md`](./vision.md) · [ADR 0023](./adr/0023-oss-only-no-hosted-arm.md) · [ADR 0017](./adr/0017-oss-self-host-first-distribution.md)

Highest leverage, ~half a session. Stops every future session re-deriving dead commercial
strategy.

- [x] **Vision / charter** → [`vision.md`](./vision.md): what it is, who it's for, why it
  differs from CodeRabbit Atlas, explicit non-goals.
- [x] **ADR 0023** → [`adr/0023-oss-only-no-hosted-arm.md`](./adr/0023-oss-only-no-hosted-arm.md);
  ADR 0017 banner'd "superseded in part".
- [x] **Archive** → [`archive/`](./archive/): commercial-strategy (moat / open-core split /
  headless / PMF validation track, lifted from `next-steps.md`) + validation-todo (old
  `docs/todo.md`). `next-steps.md` + the `mvp/` validation docs (`validation-plan`, `phase-1`,
  `center-of-gravity`) carry superseded/amended banners.
- [x] **CONTEXT.md** de-moated (Analysis Layer entry + direction note); vocabulary unchanged.

*Implication:* cheap, clarifying, unblocks honest decisions downstream.

### P1 — Nail the front door (brand surface)  ·  status: [x] done (2026-07-01, PR #13)

**Needs grilling:** No — design iteration, not a decision-tree (use the `frontend-design` / `impeccable` skills + the flexer reference). · **Docs:** [`plans/p1-front-door.md`](./plans/p1-front-door.md) (**detailed scope + design/a11y checklist + deferred-with-triggers**) · [`vision.md`](./vision.md) · [`plans/web-generate-from-url.md`](./plans/web-generate-from-url.md) (the paste-URL flow)

The stranger's first impression — for an unknown OSS project this drives word-of-mouth far
more than the backend.

- Polish the existing **paste-a-PR-URL** / `npx <pr-url>` flow + the **static demo** into a
  no-signup, no-key, genuinely impressive experience (baked demo brief; no key required to look).
- Hosted **static demo link** + a top-tier **README** (the thing people actually share).
- **Taxonomy-led framing** (locked 2026-06-30): demo + README lead with the *built*
  differentiator (stable taxonomy + playbooks + risk-as-facts), **not** the parity features
  Atlas also ships. The README may stake the AI-authored-code positioning in copy now.
- **Fold in the important design + a11y fixes** from the 2026-06-30 assessment — front-door
  copy de-jargon, hero/empty-state, `--faint` contrast (fails AA at 3.28:1), skip-link, toast
  live-region, brief `h1`, favicon/OG, **keyboard nav (`J`/`K`/`Z`/`?`)**. Full checklist +
  baseline scores (Design 26/40, Audit 14/20) in [`plans/p1-front-door.md`](./plans/p1-front-door.md).
- **P2 scope-check pulled forward** into P1 (read-only; it's grilling-free) so the demo framing
  knows what narrative slice it can show.

*Implication:* do this before the backend (P4). First-run experience and clarity > a webhook
daemon nobody has discovered. Deferred design/a11y items (mobile header, header declutter, SR
pass, touch targets…) each carry an explicit *when-to-do* trigger in the plan doc.

### P2 — Narrative-on-top-of-taxonomy (marquee comprehension feature)  ·  status: [x] done (2026-07-02, PR #16)

**Needs grilling:** Yes — the ordering rule, terminology vs Atlas's "layers/cohorts", and how narrative relates to Change-groups all touch the domain model. · **Docs:** [`../CONTEXT.md`](../CONTEXT.md) (Change-group / Summary / Category) · [ADR 0005](./adr/0005-intent-on-change-group-two-view-projection.md) · [`competitive-analysis.md`](./competitive-analysis.md) (narrative vs taxonomic axes) · [`next-steps.md`](./next-steps.md) (deferred narrative note)

The v2-parked narrative layer, promoted because it's the most *visible* gap vs Atlas and it's
where our taxonomy substrate becomes a real edge.

- **What it is:** a dependency / reasoned-reading-order sequence laid *on top of* the existing
  stable change-groups ("schema → logic → call sites → tests"). Two orthogonal axes —
  **taxonomic** (stable categories: `pure-move`, `schema-change`, `lib-bump`…, already built)
  and **narrative** (reading order, parked). Neither subsumes the other.
- **Why now / why differentiated:** Atlas ships narrative (dependency-ordered "layers") but
  **without** stable taxonomy underneath — theirs is PR-local, can't anchor a playbook. Ours
  sits on stable categories → narrative-on-top-of-taxonomy is the exact edge, and it directly
  amplifies P1's demo.
- **First task = scope check.** Confirm what already exists: there are Story/Concern views +
  chunk sorting (`group-sort-role-badges`, sort-by-concern), but likely **no explicit
  reasoned-sequence ordering of groups** yet — current order is probably structural, not
  narrative. Verify, then build the ordering + a walkthrough nav over it.
- **Scope:** frontend-only, no backend needed. Fits cleanly after the front door.

*Implication:* highest-visibility comprehension feature; turns the taxonomy substrate into a
demonstrable advantage over Atlas.

### Cheap win — Keyboard navigation + focus mode  ·  status: [x] shipped with P1 (2026-07-01)

**Needs grilling:** No — established UX pattern (apply the `web-accessibility` skill at build time). · **Docs:** [`plans/p1-front-door.md`](./plans/p1-front-door.md) (item 8) · reuses existing scroll-spy / group-TOC machinery.

Small, high-polish, demo-impressive. **Now in-scope for P1** (resolved 2026-06-30): ships with
the front-door work since it sharpens the demo, and naturally extends to P2's walkthrough nav.

- **What it is:** keyboard-driven movement through the brief — next/prev across chunks (and,
  once P2 lands, across groups/layers) plus a **focus mode** that isolates the current
  unit. Modeled on Atlas's `J` / `K` (advance / back) and `Z` (focus).
- **Why:** it's the kind of detail that makes a tool feel made-with-care on first run — high
  perceived quality per hour of work, and exactly the polish an OSS project gets judged on.
- **Scope:** frontend-only. Reuse the existing scroll-spy / active-id machinery and the group
  TOC; add a keymap + a focus/zen toggle. Respect `prefers-reduced-motion`; show a shortcuts
  hint (`?`). Don't hijack keys when a comment composer / input is focused.
- *(Surfaced 2026-06-30 from the CodeRabbit Atlas gap inventory — see Progress log.)*

### Candidate — AI-authored-code review lens (thesis differentiator)  ·  status: [x] grilled → build-ready (2026-07-03, ADR 0026)

**Grilled 2026-07-03 — scope locked in [ADR 0026](./adr/0026-ai-authorship-risk-attributes.md).**
Outcome (supersedes the "deterministic factual slice" framing below): v1 = **three
model-observed Risk-Surface attributes** (`new-dependency`, `new-abstraction`,
`comment-contradicts-code`) emitted by the existing categorization pass + validator
confirmation for `new-dependency`. **Cut:** `unresolved-import` (compilers/CI own that lane —
redundant pre-review in the target audience's repos). **Parked** behind ADR 0014's
`ContextSource` seam: `diverges-from-sibling-pattern`, `unresolved-reference` (the truly
un-linted hallucinated surface: flag/env/i18n/route string keys). **Positioning-only:** no
in-product "AI signals" grouping — attributes stay authorship-agnostic; the lens lives in
README/demo copy. No new infra: prompt + schema + validator + FE chips. Original candidate
write-up kept below for history.

**Needs grilling:** ~~Yes (before any code)~~ Done — see above. · **Docs:** [ADR 0026](./adr/0026-ai-authorship-risk-attributes.md) · [`../CONTEXT.md`](../CONTEXT.md) (Risk Surface / Intent check / Flag) · [ADR 0014](./adr/0014-external-context-and-ai-review-boundary.md) (AI-review boundary, cited-only) · [ADR 0003](./adr/0003-category-scoped-bug-hunt-not-general.md) (no-bug-bot)

The one big code-review problem **neither we nor CodeRabbit address at the product level**:
nobody reviews code *as AI-authored code*. Our whole premise is review in an AI-authored
world, yet the current feature set treats the diff generically (categorize / group / summarize).
AI-generated code fails in *characteristically different places*, and the tool should orient
the reviewer to them — **"look harder here," never "this is a bug"** (no-verdict holds).

**The failure modes (where AI specifically breaks):**
- **Hallucinated surface** — calls an API / import / flag absent from the repo or its deps.
- **New dependency / new abstraction** — pulls in a package or invents a layer for a small task.
- **Convention drift** — solves it unlike how *this* codebase (sibling files) does it.
- **Silent scope creep** — did more than the task asked.
- **Plausible-but-wrong** — reads fluently, logic subtly off.
- **Lying comments** — docstring/comment contradicts the code.

**Why it fits us (mostly a reframe, not net-new infra):**
- Extends existing machinery: **Intent check** already catches "done-but-unstated" (= scope
  creep); **Risk Surface** is the natural home for new *factual* attributes
  (`unresolved-import`, `new-dependency`, `new-abstraction`, `diverges-from-sibling-pattern`,
  `comment-contradicts-code`).
- The factual signals are **deterministic / static** (does this import resolve? is this dep
  new?) — no LLM-confidence needed, stays clean of bug-bot territory.
- **Brand line CodeRabbit can't say** without abandoning their bug-bot positioning: "built for
  the reality that a machine wrote the code." (They *market* the AI-code problem; their product
  still reviews generically + ships severity labels.)

**Should this be v1? — Partially. Split it:**
- **v1 (the signature factual slice):** the cheaply-detectable, deterministic attributes above
  surfaced through Risk Surface. Low build risk, no-verdict by construction, and it's the brand
  story — worth carrying into the first public release. Sequence it **after P1/P2** (front door
  + comprehension edge come first), as the depth layer that rewards a closer look.
- **post-v1 (the judgment slice):** plausible-but-wrong and over-engineering as *gentle
  attention-routing* only. Needs careful no-verdict framing and is harder to do reliably.

**Grill before building:** "AI failure modes as factual risk-surface attributes without sliding
into bug-bot" is a real design decision — run `grill-with-docs` on it (touches Risk Surface +
Intent check vocabulary in `CONTEXT.md`, possibly a new ADR) before any code.

### P3 — Playbook library as community commons  ·  status: [x] done (2026-07-04)

**Needs grilling:** No for the commons itself (schema + `CONTRIBUTING` is execution); the *contribution governance* (who may add/approve items) is a separate later grill. · **Docs:** [`mvp/playbooks.md`](./mvp/playbooks.md) · [`mvp/labeling-schema.md`](./mvp/labeling-schema.md) · [`../CONTEXT.md`](../CONTEXT.md) (Playbook)

The OSS-native hook CodeRabbit structurally can't match (closed).

- Document the **taxonomy + playbook schema**; add a `CONTRIBUTING` for playbooks with
  examples; frame it as the contribution surface ("ESLint-rules for code-review comprehension").

*Implication:* identity + community; turns "another review tool" into "the open taxonomy /
playbook standard."

### P4 — M1 self-host backend, rescoped as "make self-hosting real"  ·  status: [ ] not started

**Needs grilling:** No — the decisions are already locked in ADRs; this is execution (drop only the hosted/multi-tenant scope per ADR 0023). · **Docs:** [`plans/product-backend-epic.md`](./plans/product-backend-epic.md) · [ADR 0015](./adr/0015-self-hosted-runtime-postgres-single-dependency.md) · [ADR 0016](./adr/0016-github-app-auth-and-trust-tenancy-boundary.md) · [ADR 0018](./adr/0018-m1-postgres-schema.md) · [ADR 0020](./adr/0020-brief-trigger-and-activation-model.md) (also 0006/0008/0013)

Not "build a SaaS." See `docs/plans/product-backend-epic.md` workstreams 1–3 (reframed).

- Postgres-only persistence (ADR 0018) + GitHub App + background worker (wraps the existing
  `Generator` as-is); **BYOK default**; **one-command docker-compose**.

*Implication:* necessary for it to be a living tool on real repos, but only compelling **after**
P1/P2 make people want it. Don't lead with it.

### Future — Cross-PR / temporal awareness  ·  status: [ ] future (infra-gated)

**Needs grilling:** Yes (when un-parked) — the signal set and how to surface history without it reading as a verdict. · **Docs:** [ADR 0008](./adr/0008-brief-delta-persistence-and-fetching.md) (persistence/fetching) · [`archive/commercial-strategy.md`](./archive/commercial-strategy.md) (the "cross-PR repo history" note, reframed as comprehension)

Another problem **nobody addresses well**: review in isolation, blind to history. Surface the
*temporal* context of a change — "this area changed 3× this month," "conflicts with open PR #X,"
"reverts / re-touches the fix from #Y," "this file is a recurring churn hotspot." Comprehension-
aligned, factual, no-verdict.

- **Why it's ours to win:** the **stable taxonomy** makes cross-PR history *queryable* in a way
  Atlas's PR-local cohorts can't ("every `schema-change` to this module this quarter").
- **Why it's future, not v1:** needs **persistence + multi-PR state** (depends on the P4
  backend) — not solo-cheap, and only pays off once several PRs of history exist.
- Pairs with the moved-but-not-dead "cross-PR repo history" idea (see `archive/`), reframed as
  comprehension, not moat.

### P5 — Deferred / dropped  ·  status: n/a

**Needs grilling:** n/a (no build; if any item is ever revived, grill it then). · **Docs:** [ADR 0010](./adr/0010-tiered-generation-triage.md) (triage) · [ADR 0007](./adr/0007-delta-comment-anchoring-and-flag-carry-over.md) (carry-over) · [`archive/`](./archive/) (dropped commercial items)

Notes only, no build: triage cascade, per-reviewer carry-over, org-learned playbooks / digest,
hosted arm, headless API, semantic/code-graph + diagram arms race.

---

## Progress log

- 2026-06-30 — Doc created. OSS-only decision recorded; CodeRabbit Atlas overlap researched;
  priorities P0–P5 agreed. Awaiting confirmation to start P0.
- 2026-06-30 — **P0 done.** Added `vision.md` + ADR 0023; archived commercial strategy +
  validation track under `docs/archive/`; banner'd `next-steps.md`, ADR 0017, and the `mvp/`
  validation docs; de-moated `CONTEXT.md`. Branch `docs/oss-only-reframe`. **Next: P1
  (front-door polish)** — pending go.
- 2026-06-30 — Studied CodeRabbit Atlas (blog + demo video) for gaps. Logged **Keyboard
  navigation + focus mode** as a cheap-win item. Other gaps noted but not logged: per-layer
  summary rail (folds into P2), generated diagrams (post-P2 candidate, scope to ER/schema via
  taxonomy), code peek (heavier, deferred). Deliberate non-gaps (reject): severity labels,
  one-click AI fixes, AI-authored comments, code-graph/LanceDB scale.
- 2026-06-30 — Motivation reset: going forward on **design-led craft** as a real differentiator
  (Idan would use the tool; dislikes Atlas's look). Added two product ideas neither tool does:
  **AI-authored-code review lens** (candidate; factual slice recommended *partially v1*, after
  P1/P2; grill before building) and **cross-PR / temporal awareness** (future, gated on the P4
  backend). "Ripoff" concern resolved → OSS "open alternative to X" is a respected positioning;
  own the comparison.
- 2026-07-01 — **P1 done** (PR #13, `feature/p1-front-door`). Front-door polish +
  in-scope a11y fixes landed, including keyboard nav (`J`/`K`/`Z`/`?`). Mobile brief
  header stays deferred with its pull-forward trigger (scope record in
  [`plans/p1-front-door.md`](./plans/p1-front-door.md)).
- 2026-07-02 — **Comparison overlay + Revision narrative shipped** (PR #14, ADR 0024;
  not a roadmap P-item — grew out of ADR 0021's overlay). Timeline + View/Compare
  model replaces the Full/Delta lens; non-first Briefs get a generated shared
  Revision narrative; mechanical marks drive highlights for both baselines. Legal
  detail sanitized from ADRs 0017/0023 + system-overview/oss-roadmap ahead of going
  public. Follow-ups recorded in
  [`plans/comparison-overlay-and-revision-narrative.md`](./plans/comparison-overlay-and-revision-narrative.md)
  (Delta-path huge-span wiring, incremental diffs sidecar, YAML config loader).
  Pre-existing duplicate-key bug in the summary preview found during the browser
  pass → PR #15.
- 2026-07-02 — **P2 done** (PR #16, `feature/reading-order`; ADR 0025, plan in
  [`plans/reading-order.md`](./plans/reading-order.md)). Every full Brief can carry a
  **Reading order** — a strict, foundation-first permutation over its Change-groups with
  no-verdict why-lines — emitted in the Brief's own call, validated warn-and-drop on both
  sides, degrading to structural order. FE ships the **Read-through** experience: Story
  view adopts the order (step captions), `Shift+J`/`Shift+K` group navigation, "Start
  read-through" affordance. Terminology deliberately avoids Atlas's layers/cohorts and
  CodeRabbit's walkthrough. Browser-pass follow-ups (focus-mode overlay bugs, rail
  scrolling, segmented read-through progress, auto-advance on viewed) recorded in the
  root `todo.md` for one follow-up PR.
- 2026-07-03 — **AI-authorship lens grilled → ADR 0026.** The "deterministic factual slice"
  framing didn't survive audit (only 2 of 5 attributes were deterministic; one needed repo
  access the pipeline doesn't have and is compiler-redundant anyway). Landed scope: three
  model-observed attributes (`new-dependency` + validator confirm, `new-abstraction`,
  `comment-contradicts-code`), positioning-only (no in-product AI grouping),
  `unresolved-import` rejected, sibling-pattern + `unresolved-reference` parked behind
  ContextSource (ADR 0014). Tokens registered in `labeling-schema.md` / `risk-surface.md`;
  CONTEXT.md ambiguity recorded. **Next: implement the trio (small PR), then P3.**
- 2026-07-03 — **Read-through follow-ups + lint tooling merged.** PR #17: the six PR #16
  browser-pass items (shortcuts-dead-after-commenting, focus banner overlap, composer
  clipping, scrollable rail, segmented progress, auto-advance — the last generalized to any
  focus mode, `readThroughActive` removed). PR #18: oxlint (type-aware, `react-hooks`
  rules) across `apps/web` + `tools/categorizer`, wired into CI as parallel matrix jobs.
  **Next: grill the AI-authored-code review lens** (P1/P2 gate now open), then P3.
- 2026-07-04 — **ADR 0026 trio shipped** (PR #19, `feature/risk-attr-trio`; plan in
  [`plans/ai-authorship-attributes.md`](./plans/ai-authorship-attributes.md)). The three
  model-observed attributes land end to end: schema + prompt discipline + warn-and-drop
  validation (`comment-contradicts-code` citation gate, `new-dependency` section-aware +
  chunk-scoped manifest confirm, plus a `removes-validation` additive-chunk gate added after
  a live FP) and FE rendering (bounded header chips with a floating-ui Callout, riskNotes
  evidence lines in the rail, risk-name summary under the changelog). Review-driven
  follow-ups landed in-PR; a diff-viewport composer clipping bug got fixed en route.
  Regenerating PR #19's own brief then surfaced that Anthropic structured output doesn't
  enforce `enum` server-side (SDK demotes it to description prose) → **PR #20**: salvage
  (warn-and-drop for supplementary enum arrays) + one feedback retry + raw-output failure
  dumps. Live BYOK regen verified: trio fires, `new-dependency` confirmed on the
  floating-ui manifest chunk, `removes-validation` FP dropped at generation time.
  **Next: ADR 0026 positioning copy pass (README/demo — the lens is positioning-only by
  design, so it's invisible until the copy stakes it), then P3.** Follow-up filed in PR #20:
  spike hand-built `json_schema` with `enum` intact for server-side enforcement.
- 2026-07-04 — **Positioning copy pass done — and the AI-authorship angle killed.**
  Drafting the README section surfaced that the framing doesn't hold: every failure mode
  the trio targets is authorship-independent (humans write born-false comments too), so
  the copy either over-claimed or immediately conceded its own headline. Direction locked
  (Idan): the main idea is a **clearer, more organized review experience for author and
  reviewer** — follow the story of a change, route attention, cut review iterations. The
  AI era stays world-context in `vision.md`, never the product's identity. README
  rewritten authorship-neutral; stale "deterministic" Risk-Surface claims corrected to
  observation-language; ADR 0026 amended (positioning clause withdrawn; the three
  attributes + authorship-agnostic product decisions stand). **Next: P3 (playbook
  commons).**
- 2026-07-04 — **P3 done** (docs-only, straight to main). Root `CONTRIBUTING.md` frames the
  taxonomy + playbook library as the contribution surface ("ESLint-rules for code-review
  comprehension"): the three axes + attach points, playbook item format (action-shaped /
  mechanically checkable / specific / failure-mode-grounded), risk-attribute entry format,
  add + deprecate protocol (register-first in `labeling-schema.md`), and the doc→code
  lockstep checklist (`types.ts`, `prompt.ts`, FE `types.ts` + `playbooks.ts`). Contribution
  *governance* deliberately deferred per plan (separate later grill). En route: found docs
  lagging code — FE `playbooks.ts` shipped all 8 Category playbooks + 5 Concern checks while
  `playbooks.md` (source of truth) had 5 + 2; backfilled `pure-move` / `dependency-update` /
  `schema-change` + `spec`/`config`/`generated` checks with failure-mode lists, synced
  `labeling-schema.md` statuses. README gained a Contributing section. Prose kept
  authorship-neutral per the 2026-07-04 positioning lock. Leftover (code, trivial): stale
  "16 factual attributes" comment in `tools/categorizer/src/types.ts` header (actual: 19).
  **Next: P4 (self-host backend) or the PR #20 `json_schema` enum spike.**
- 2026-06-30 — **P1 design + a11y assessment.** Inspected the live app (Playwright, desktop +
  mobile, picker + brief) + code via the `impeccable` and `web-accessibility` skills. Verdict:
  design is genuinely good (slop scan near-clean; strong token system + real diff tables +
  taxonomy UI); gaps are **front-door framing** (author-facing jargon, no value prop) and a few
  concrete a11y misses (`--faint` contrast 3.28:1 fails AA, no skip-link, silent toast, no brief
  `h1`). Baseline: Design 26/40, Audit 14/20 (A11y + Responsive the weak dims). Bucketed every
  finding into **In-P1 / Deferred-with-triggers / Won't-do**; full record in
  [`plans/p1-front-door.md`](./plans/p1-front-door.md). **Resolved:** keyboard nav (`J`/`K`/`Z`/`?`)
  folded into P1; mobile brief header deferred (demo is desktop-framed) with a pull-forward trigger.
