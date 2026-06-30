# OSS Roadmap & Prioritized Next Steps

> **Status doc — read first each session.** Tracks the prioritized work for the OSS-only
> direction. Update the status boxes as items move. Created 2026-06-30.

## Context (why this doc exists)

The project is now **OSS-only** — no hosted product, no commercial/SaaS arm. Two drivers:

1. **Visa constraints.** UK Skilled Worker status: hosted data-liability and the employer IP
   clause are the real blockers (a non-hosted OSS side project is the safe shape).
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

### P1 — Nail the front door (brand surface)  ·  status: [ ] not started

The stranger's first impression — for an unknown OSS project this drives word-of-mouth far
more than the backend.

- Polish the existing **paste-a-PR-URL** / `npx <pr-url>` flow + the **static demo** into a
  no-signup, no-key, genuinely impressive experience (baked demo brief; no key required to look).
- Hosted **static demo link** + a top-tier **README** (the thing people actually share).

*Implication:* do this before the backend (P4). First-run experience and clarity > a webhook
daemon nobody has discovered.

### P2 — Narrative-on-top-of-taxonomy (marquee comprehension feature)  ·  status: [ ] not started

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

### P3 — Playbook library as community commons  ·  status: [ ] not started

The OSS-native hook CodeRabbit structurally can't match (closed).

- Document the **taxonomy + playbook schema**; add a `CONTRIBUTING` for playbooks with
  examples; frame it as the contribution surface ("ESLint-rules for code-review comprehension").

*Implication:* identity + community; turns "another review tool" into "the open taxonomy /
playbook standard."

### P4 — M1 self-host backend, rescoped as "make self-hosting real"  ·  status: [ ] not started

Not "build a SaaS." See `docs/plans/product-backend-epic.md` workstreams 1–3 (reframed).

- Postgres-only persistence (ADR 0018) + GitHub App + background worker (wraps the existing
  `Generator` as-is); **BYOK default**; **one-command docker-compose**.

*Implication:* necessary for it to be a living tool on real repos, but only compelling **after**
P1/P2 make people want it. Don't lead with it.

### P5 — Deferred / dropped  ·  status: n/a

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
