# Next Steps

> **⚠ Superseded in large part by the OSS-only pivot (2026-06-30) — [ADR 0023](./adr/0023-oss-only-no-hosted-arm.md).**
> The current sources of truth are [`vision.md`](./vision.md) and
> [`oss-roadmap.md`](./oss-roadmap.md). The commercial strategy sections were removed to
> [`archive/commercial-strategy.md`](./archive/commercial-strategy.md). What remains below is
> **pre-pivot context** — the 2026-06-13 reshape, deferred product features, confidence-score
> notes, and the competitive scan — kept for history. Read it as background, not as the plan;
> anything assuming a hosted product, moat, headless go-to-market, or formal validation is dead.

Running list of items to revisit in future sessions. Grouped by type.

## ⮕ Direction reshape (2026-06-13) — read first

The product's center of gravity was reshaped after the discovery interviews (`docs/interviews/synthesis.md`), most sharply by **D** (a senior who challenged the playbook). Full statement in **[`mvp/center-of-gravity.md`](./mvp/center-of-gravity.md)** — that doc is now the source of truth; sections below predate it and are partially superseded where noted.

Headline shifts:
- **Center of gravity = velocity-without-the-stability-tax** (PR-creation → merge, minimal re-review), delivered through **story + intent** and **quality / risk-surface**. Velocity is the *byproduct* of quality, never the metric sold — else it's a rubber-stamp accelerator.
- **Lead value story:** re-review is a context-switch tax (reload the mental model of a PR you last saw days ago). The **delta brief** does the reload for you — cheap context-switch, not shallow review. Highest-pain, least-Linear-overlapping, least-contested thing in the interviews (3/3 vivid).
- **Demotions:** playbook → agent-facing + optional junior UI (not a human headline panel); private mind-map → persistence only (thinking-space framing cut); taxonomy + concern-grouping → engine, not headline.
- **Author side promoted to v1** (held loosely): the same brief one step earlier, so re-review is *prevented* before submit. Needs its own grilling pass.
- **Activation:** opt-in **draft-first** via repo YAML + GitHub App webhook, native-draft fail-open. Reverses the lazy cost gate.
- **Comment-to-rule loop** (v2+): accepted, *role-gated*, valuable comments → repo-local agent context (md) via reviewed PRs → agents stop repeating mistakes. The playbook's real destiny and the most defensible moat candidate (supersedes the hosted org-learned-playbooks framing below).
- **Org primary, individual door open, OSS = free distribution.**
- **Gating consequence:** Phase 1's Treatment-vs-B′ tests the now-demoted playbook → redefine the experiment around story + risk + delta *before* labeling (`phase-1.md`).

## Unresolved from Grilling Session (2026-05-19)

These four items came up during the reviewer-side scope grilling but were deferred — they need their own focused conversation.

1. **Pricing model and ICP.** Who's the buyer (eng manager, tech lead, IC, CISO)? Seat-based or org-based? Free tier shape? What's the per-seat price target relative to CodeRabbit ($24/dev), Graphite Diamond ($40), Greptile? Pricing follows whoever felt the pain enough to pull out a card during interviews.
2. **"Uncertain" threshold calibration.** When does the AI label its category/flag output as `uncertain`? Per-category threshold (some categories are easier to classify than others)? Per-playbook? Single global threshold? Tied to model confidence score or to disagreement between multiple passes?
3. **Two-reviewers-same-flag UX.** When two reviewers dismiss the same flag with different reasons, what does the receipt show — both reasons attributed, latest only, or some merged form? UX detail but matters for multi-reviewer audit trail.
4. **Bottoms-up POC flow for individuals.** Onboarding assumes admin installs the GH App org-wide. How does a single curious reviewer try the tool on their personal repos before pitching it upward? Distribution path for grassroots adoption.
   **Resolved direction (2026-06-09): zero-install try path, promoted to a planned v1.5 deliverable** (shape may shift, commitment shouldn't). A single engineer pastes any public-PR URL into the web app (or runs `npx <tool> <pr-url>`) → brief renders read-only via the public GitHub API. No GH App, no admin, no OAuth. Rationale: the actual adopter is a single curious reviewer, and under the useful-tool-first intent (see "Project Intent" in `docs/problem-framing/initial.md`) peers trying it IS the distribution model. Also doubles as the Phase 2 demo surface — and, if the open-core direction is taken, the OSS BYOK client is this same artifact (see "Open-Core / BYOK Split" below).

## Author Side (v2) — Full Grilling Pending

The placeholder bullets at the bottom of `docs/mvp/initial-scope.md` have not been walked through the grilling process yet. Whole branch needs its own session — apply the same decision-tree treatment.

Specific branches to drill when that session happens:
- Where does the author flow surface — same web app, IDE plugin, CLI, or pre-commit hook?
- "Are you sure you want to submit?" gate — soft warning, blocking modal, or in-place inline?
- How does author-side mind-map relate to reviewer-side mind-map across the same PR — separate spaces, shared, or one-way visibility?
- Self-review brief vs reviewer brief — same artifact or different lenses?
- Reply-to-reviewer flow: where does the agent chat for understanding comments live (PR view, dedicated panel, threaded with each comment)?

## Deferred Product Features (v1.5+)

Decided in scope but explicitly pushed past v1:
- **Orchestrate competitor bug-catchers (B from Q6).** Ingest CodeRabbit/Greptile output, dedupe against reviewer's own comments, surface gaps as additional structural flags.
- **Selective "promote to PR thread" (C from Q7).** Reviewer can one-click push a private agent chat exchange to the public PR thread when useful for the author.
- **Manual-trigger config knob.** Only if customer pull surfaces during sales conversations — default stays auto-debounced.
- **"Mind space grows beyond code review."** Long-tail ambition: the private thinking-space metaphor could extend to other engineering decisions (RFCs, post-incident reviews, design docs). Park as future direction; fence MVP strictly to PR review.
- **Narrative-chapter walkthrough layer (v2+).** A Linear-style "order the work was reasoned through" sequence laid *on top* of the taxonomy change-groups. The structured walkthrough (the Brief: groups + Summary + Story/Concern views) is **v1 core**; this is the optional narrative ordering over it — narrative-on-top-of-taxonomy, neither axis subsumes the other. (See `competitive-analysis.md`.)
- **Codebase-context enrichment (v3 / post-validation, behind ADR 0014).** A full-repo index feeding the *risk-surface blast-radius* attributes (`widely-imported`, `cross-service`, `external-io`) + cleaner change-group boundaries — framed as a risk-surface upgrade, not bug-catching. Heaviest infra add, but **pgvector on the existing Postgres keeps the single-stateful-dependency principle** (ADR 0015). Cited-only / no-verdict still binds (ADR 0014) — enrich with facts, never hypothesized issues.

## Confidence scores + FP-suppression (now → future)

Decision (2026-06-19): integrate self-reported confidence **now**, defer the calibration engine.

- **Now — M1 categorizer enhancement** (behind ADR 0013's structured-output floor). Add a `confidence` field per **Categorization** and per **Flag** in the generation output — lives inside the brief JSON (TEXT passthrough), **no DB schema change** (ADR 0018 untouched). Wiring: `confidence < threshold` → emit the existing **`Uncertain`** label (forces human judgment); surface the score *understated* (like Generation origin), **never an auto-gate or silent suppressor** (no-verdict + anti-noise). Value is twofold — asking for confidence + rationale improves the model's self-validation, and the threshold drives `Uncertain`.
- **Caveat:** self-reported LLM confidence is **poorly calibrated** (systematically overconfident; not a true probability). Treat it as a *relative* signal, not a calibrated one — hence no gate.
- **Future — the real FP-suppression rigor.** Better-calibrated signals at higher cost/complexity: **multi-pass / self-consistency** (run N times; disagreement → `Uncertain`) and **exhaust-tuned per-category thresholds** learned from **Dispositions** (dismissals/reclassifications) — the latter doubles as a data-exhaust moat candidate (see Moat Honesty).

## Competitive Scan — see `docs/competitive-analysis.md`

Current landscape (positioning, funding, favorability, features-to-take) lives in **[`competitive-analysis.md`](./competitive-analysis.md)** (2026-06-18). Durable strategic conclusions from the original 2026-05 scan, retained:

- **Different evaluation lane.** Intent taxonomy + playbooks + private engagement + no-verdict put us against the *status quo behavior* ("skim AI summary, click approve"), not against CodeRabbit/Greptile/Qodo. Trade-off: selling a new mental model is slower; customer-education cost is real.
- **"No competitor does X" is a weak signal** — genuine gap, tried-and-failed, market-doesn't-reward (loud-want "catch bugs", quiet about "help me think"), stealth, or already-inside-something-else. Don't over-read absence.
- **Validation requirement:** the wedge is validated only when customers *spontaneously* reach for intent-structure / per-category review / a private thinking space / a verification receipt — never when prompted. "Better bug catching" instead → investigate whether the wedge is wrong or just described differently.

## Competitive Update — Linear Diffs

Current state in **[`competitive-analysis.md`](./competitive-analysis.md)** (Linear Diffs GA'd May 2026: review-inside-Linear, guided reviews, agents + MCP). Durable strategic conclusions, retained:

- **Narrative vs taxonomic grouping (independent axes).** Linear groups by *story* (PR-specific narrative chapters); we group by *stable taxonomy* (`pure-move`, `lib-bump`, `schema-change`…). Theirs isn't cross-PR queryable and can't anchor a per-category playbook; ours can. Neither subsumes the other — either could later add the other's axis. Pitch Linear as **complement, not competitor**; watch if they add stable taxonomy + playbooks (tail risk to our edges).
- **Grouping is now table stakes (2026-06-07).** Change-groups + carrier/supporting + concern split + adjusted LoC put us *onto Linear's substrate* ("surface core parts first, group supporting changes separately" = carrier-vs-supporting). Stop pitching grouping as a differentiator — defensibility is the layer *on top*: stable taxonomy, per-category playbooks, risk-surface, receipt, delta.
- **Methodological consequence:** Phase 1 tests **Treatment vs Baseline B′** (grouped substrate with the differentiator layer stripped ≈ Linear-equivalent) to isolate whether that layer beats what Linear gives free. Raw-diff baseline dropped. See `phase-1.md`.
- **Distribution risk > feature risk.** Linear has captive PM users; we don't. Counter is the different lane + OSS self-host/BYOK (see `competitive-analysis.md` §5).

### Two-layer / dual-consumer model (formalized in CONTEXT.md, 2026-06-07)

- **Analysis Layer** (change-groups, taxonomy, playbooks, risk-surface, concern split, LoC) — reviewer-agnostic core; serves both humans and AI-agent reviewers. *(2026-06-13: this is the engine, not the moat — see the reshape at the top and `mvp/center-of-gravity.md`. The defensible core is delta + comment-to-rule + dual-consumer + integrated create-to-merge workflow, not the taxonomy/playbook alone.)*
- **Engagement Layer** (no-AI-text rule, private mind-map, seeds, human-written comments, approval + receipt) — human-only workflow.
- **Dual-consumer:** human reviewer consumes Analysis via Engagement (v1); AI-agent reviewer consumes Analysis directly via API (v1.5+ headless lead-in — confirmed NOT in first release). The no-AI-text rule and mind-map are human-mode only; agent-mode inverts the text rule by design.
- **Submission:** review lands natively on GitHub (comments + verdict) authored by the reviewer; a one-line signature links to a static **Review Summary** holding the receipt. Tool present but unobtrusive (ADR 0002, 2026-06-07 delivery refinement).

## Retired commercial strategy → `docs/archive/`

> **Moved 2026-06-30 (OSS-only pivot, [ADR 0023](./adr/0023-oss-only-no-hosted-arm.md)).**
> The four strategy sections that used to live here — **Moat Honesty**, **Open-Core / BYOK
> Split**, **Headless Distribution**, and the **PMF Validation Track** — assumed a hosted /
> commercial product that will not be built. They are archived verbatim in
> [`archive/commercial-strategy.md`](./archive/commercial-strategy.md). Do not act on them.
>
> Live sources of truth: [`vision.md`](./vision.md) · [`oss-roadmap.md`](./oss-roadmap.md) ·
> [ADR 0023](./adr/0023-oss-only-no-hosted-arm.md).
