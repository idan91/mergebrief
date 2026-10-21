# Commercial strategy (ARCHIVED — superseded by OSS-only, 2026-06-30)

> **These sections are retired.** They were lifted verbatim out of `docs/internal/next-steps.md` when the
> project committed to being **OSS-only** ([ADR 0023](../adr/0023-oss-only-no-hosted-arm.md)).
> They assume a hosted/commercial product that will not be built. Kept for reasoning history;
> do not act on them. See [`README.md`](README.md) for why each is dead and
> [`../vision.md`](../../vision.md) / [`../oss-roadmap.md`](../oss-roadmap.md) for what replaced them.

---

## Moat Honesty (2026-06-09)

Terminology fix across the docs: the taxonomy + playbooks + risk-surface layer is the **wedge**, not the moat. A moat is a structural defense that stops competitors copying you *after* the idea is proven (switching costs, network effects, proprietary data, distribution lock-in). A feature is not a moat.

**Why the old claim was soft:** taxonomy + playbooks are prompt engineering plus a markdown library — any competent team rebuilds them in weeks. CodeRabbit/Greptile can ship "change-type-aware checklists" in a sprint *once Phase 1/2 success proves the wedge works*; our validation becomes their spec. The docs previously watched Linear closely while underweighting incumbent copy speed.

> **Concretized 2026-06-13 → the comment-to-rule loop.** The "org-learned playbooks" idea below has a concrete, more defensible instantiation in `mvp/center-of-gravity.md`: accepted, **role-gated**, valuable review comments are promoted (by CODEOWNERS / YAML-declared approvers, as reviewed PRs) into **repo-local agent context (md)**, so agents stop repeating mistakes. Repo-local + portable (transparent, OSS-friendly) rather than hosted-proprietary — so the moat shifts from *owning the data* to *the engine that produces good rules* + the in-platform exhaust competitors can't see (dismissals, reclassifications, recurrence). This **supersedes** the hosted framing below as the primary mechanism; the bullets remain as the conceptual ancestor.

**What could compound into a real moat (earned, not claimed):**
- **Data exhaust.** Every reviewer reclassification, dismissal-with-reason, and playbook-item visit is labeled training data nobody else has. It improves the categorizer; competitors start cold.
- **Org-learned playbooks (2026-06-09; concretized 2026-06-13 as the comment-to-rule loop — see note above).** Preset playbooks are the commodity layer; the compounding layer is per-org playbook items mined from that org's own review activity on the platform — recurring review comments, dismissal reasons, flag-address patterns — summarized into suggested additions ("in this repo, `schema-change` also means check the analytics consumer"). Proprietary where it draws on in-platform exhaust (dismissals, reclassifications, item visits — invisible to competitors); only semi-proprietary where it draws on GitHub comment history (any installed tool can mine that). Guardrails: **role-gated** human-approve loop (CODEOWNERS / YAML-declared approvers accept suggested items before they activate — never auto-commit, never a junior's one-off comment self-promoting), org data never trains other orgs' playbooks, cold-start means this only pays after months of usage. Post-validation work; parked here as the concrete mechanism behind "data exhaust".
  - **Playbook digest (2026-06-09, v2+).** The visibility surface for the learning loop: a recurring summary of suggested playbook additions — "3 suggested additions to `schema-change`, mined from 14 reviews — approve/reject." Doubles as (a) the tech lead's approval inbox (without it, suggestions rot in a settings page) and (b) a team-facing institutional-knowledge artifact ("what our reviews taught us about our codebase this week") — direct feed for the skill-atrophy / review-as-learning-loop positioning (problem-framing HMW #5). Cadence: weekly, **threshold-gated** (send when ≥N pending suggestions OR weekly, whichever first) — never daily; additions are rare events and empty digests train people to ignore it. Hosted-only by nature (requires cross-PR org state — see Open-Core Direction below).
- **Cross-PR repo history.** The stable taxonomy makes "all `schema-change` PRs last quarter" queryable; value grows with tenure on a repo.
- **Workflow lock-in.** Receipts as an org's review audit trail = switching cost.

**Rule:** product docs say "wedge" for the layer, "moat" only for the earned candidates above. `CONTEXT.md` Analysis Layer entry updated accordingly.

## Strategic Direction — Open-Core / BYOK Split (2026-06-09, decision deferred to post-Phase-2)

Candidate distribution model: **OSS BYOK client + hosted product**, with an unusually honest cut line — the split falls exactly where server state begins, so the OSS version is genuinely useful rather than artificially crippled.

### The cut line: stateless comprehension is free; organizational memory is the product

- **OSS BYOK (stateless layer):** brief on a single PR — categorizer, preset playbooks, risk-surface, concern split. Runs with the user's own API key, no server state. This is the commodity layer from Moat Honesty — copyable anyway, so open-sourcing it costs near-zero moat.
- **Hosted (stateful layer):** every moat candidate happens to require persistent cross-PR / cross-reviewer state — org-learned playbooks + digest, repo history queries, multi-reviewer aggregation, receipts as audit trail, mind-map sync, delta briefs across sessions.

### Why it compounds with existing strategy

- **Zero-install path and OSS client are the same artifact.** `npx <tool> <pr-url>` + own key = bottoms-up distribution at zero infra cost (resolves open question #4 above).
- **OSS client is a natural headless reference client.** Three strategies (zero-install, headless, open-core) collapse into one architecture — a sign the cut line is real.
- **Preset playbook library as community commons.** Playbooks are markdown — an ESLint-rules-style contribution surface. Community improves the commodity layer free; we stay the canonical home.
- **Kills the privacy objection.** BYOK + code-never-leaves-org answers enterprise trust before it's asked.
- **Fits useful-tool-first intent** (see Project Intent in `docs/internal/problem-framing/initial.md`) — peers use it free, forever.

### Honest risks

- **Conversion tension.** If OSS alone satisfies, hosted never sells. Mitigation is the natural line: single-PR briefs are useful, but the *felt compounding* (digest, history, audit trail) only exists hosted.
- **Fork risk.** Someone rebuilds persistence on top — standard open-core exposure (Sentry, GitLab, Cal.com live with it); acceptable at this scale.
- **OSS maintenance tax.** Issues, PRs, support. **Do not open-source before the wedge is validated** — otherwise we maintain a public repo for a dead idea.
- **BYOK breaks the exhaust loop for OSS users.** Self-hosted produces no dismissal/reclassification telemetry. By design: learning is hosted-only; no opt-in telemetry bolt-ons.

### Sequencing

Same gate as headless: decide after Phases 1+2 validate the wedge. One adjustment that applies **today** (strengthens the existing headless adjustment): the Phase 3 data model must keep a hard schema boundary between stateless analysis (brief computation) and stateful learning (org memory) — that boundary later becomes the OSS/hosted line, the API surface, or both.

## Strategic Direction — Headless Distribution (v2 lever, v1.5 lead-in)

A distribution edge, not a feature edge. **Not v1.** Lift after Phases 1+2 validate the wedge and 1+ team actively uses the web app.

### What headless means here

Product becomes two things:
1. **API/SDK exposing comprehension primitives** — categorization, playbooks, receipts, risk surface, mind-map state as structured objects consumable by other surfaces.
2. **Reference UI (the web app)** — one client of the API, not the whole product.

Embeds that become possible: inside Linear (their Diffs panel rendering our categories + playbooks), inside GitHub (extension/App with richer surfaces), inside Cursor/VS Code (IDE reviewer plugin), inside Slack/internal portals (enterprise), and consumption by other AI agents (Claude Code Review, Copilot agent) as structured comprehension data.

### Why it's a real edge

- **Direct answer to the Linear distribution problem.** Linear has captive PM users → being inside Linear via partnership beats competing with them. Same for Cursor, GitHub, JetBrains.
- **AI agents are a new buyer class.** Code-review agents need structured taxonomy + playbook data via API. Nobody else supplies that primitive.
- **Enterprise procurement.** Enterprises buy *layers*, not *apps*. "Comprehension primitives for code review" reads procurement-friendly; "yet another review tool" reads procurement-hostile.
- **Moats compound.** The taxonomy + playbooks are the IP. Headless makes the IP consumable everywhere.

### Why NOT in v1

- **Headless needs a strong reference UI to demo and adopt.** "We have an API" sells to nobody who hasn't seen what it does. v1 web app must prove the wedge first.
- **Headless ≠ moat.** Don't conflate. Distribution on top of the moat, not the moat itself.
- **API design is expensive.** Public contracts are hard to change. Lock-in too early = future pain.
- **Headless-as-MVP is a known PMF anti-pattern.** Liveblocks, Plate, Clerk — all shipped strong reference UIs first, headless later. None shipped API-only.
- **Partners come post-validation.** Linear/Cursor/JetBrains won't partner with an unvalidated wedge.

### Lead-in (v1.5) → Full play (v2)

- **v1.5:** Publish the data model that drives the web app as a structured public format (read-only API). Lets enterprises export receipts to internal systems; lets a curious agent consume the taxonomy.
- **v2:** Full headless API with the web app as reference client. Pursue partner embeds (Linear, IDE makers, agent runtimes).

### Two concrete adjustments to make today

1. **Design the v1 data model (Phase 3 / D) with headless in mind.** Even without exposing the API yet, internal schemas should be clean enough to lift later — Categorization, Playbooks, Receipt, Risk Surface, Mind-Map Space all as first-class structured objects.
2. **Marketing language can hint at it.** "Comprehension primitives for code review" reads differently than "another AI code review tool". Plants the headless seed without committing engineering.

### Honest risks

- **Distraction.** "Headless" feels like architectural cleverness — easy to over-invest before validating the wedge. Hold the discipline.
- **Different ICP / motion.** Headless means selling to platforms and agents, not end teams. Eng managers buy SaaS; platform teams buy APIs. Different pricing and sales motion.
- **Incumbents could go headless too.** If Linear opens an API and lets others build on their chapters, the partnership flips. Worth watching.

### Verdict

Real edge. Distribution edge, not feature edge. **v2 lever with v1.5 lead-in**, not a v1 commitment. The wedge is the taxonomy + playbooks; headless makes that wedge consumable everywhere — but only after the wedge is proven.

## PMF Validation Track (from Problem Framing)

Lifted from `docs/internal/problem-framing/initial.md` recommended next steps — these run in parallel with product scoping, not after.

1. **8–12 problem-discovery interviews** split across PR author, reviewer, tech lead, eng manager. Anchor on the rubber-stamp moment: "walk me through the last AI-authored PR you merged — where did you stop reading?" Goal: validate the *comprehension* gap (not the bug-catch gap) is the live pain.

   **Sequencing (2026-06-09): run ≥4 of these BEFORE the first Phase 1 reviewer session** — not in parallel. Interviews are the cheapest kill-test and may reshape PR selection and playbook content before labeling hours are spent. Phase 1 debriefs double as interviews (discovery questions appended *after* the review-task discussion — see `phase-1.md`), so net-new recruiting is ~4–6 people.

   **Full runnable script with probes, capture sheet, and synthesis gate: [`docs/internal/interviews/script.md`](../interviews/script.md).** Outline:
   1. Recency anchor: "Last AI-heavy PR you reviewed — walk me through it. Where did you stop reading?"
   2. Failure story: "Tell me about a bug that got through review. What happened after?"
   3. Coping: "A 600-line PR lands and you have 20 minutes — what do you actually do?"
   4. Re-review: "The author pushes follow-up commits after your review — what do you look at?"
   5. Tools tried: "What do you use now (CodeRabbit / Copilot review / …)? What stuck, what didn't, why?"
   6. Linear probe (verbatim capture — see Competitive Update above).
   7. Last 10 minutes only: show a hand-labeled brief (e.g. medusa-15605). Watch: do they grab it and start navigating, or nod politely? Grabbing = signal; polite nodding = nothing.
2. **Survey ≥100 devs** measuring % of AI-authored PRs they (a) understood fully before approving, (b) approved with reservation, (c) approved without engaging. Sizes the rubber-stamp rate quantitatively.
3. **Audit 3–5 existing tools** (CodeRabbit, Graphite Diamond, Qodo, Copilot PR review, Claude Code Review) on the author-side / pre-review / comprehension axis specifically. Score depth, friction, adoption. Map the gap.
4. **Sketch a wedge experiment.** Smallest possible "pre-review comprehension brief" an author runs on their own diff before requesting review. Test if (a) authors run it voluntarily, (b) reviewers report changed behavior.
5. **Pricing/ICP probe** (overlaps with #1 above). Which persona felt the pain enough to pull out a card?
6. **Decide v1 framing.** Build a *new product* (own surface — current direction), a *layer* inside an existing PR tool, or an *IDE-side* author-prep tool. Each implies different distribution and moat. Confirm current decision (web app + GH bridge) survives interview feedback.
