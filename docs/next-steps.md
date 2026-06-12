# Next Steps

Running list of items to revisit in future sessions. Grouped by type.

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

## Competitive Scan Findings (2026-05-19)

Preliminary breadth survey (not deep audit yet). Confirmed enough to proceed with MVP without being benchmarked head-to-head against incumbents.

### White space holds for v1
- **Diff-by-intent multi-tag categorization** at chunk level (pure-move, lib-bump, schema-change, etc.) — no observed competitor doing this. Closest is industry "materiality tiers" (size + security-sensitivity at PR level), which is coarser and on a different axis.
- **Per-category templated playbooks** as engineering checklists — competitors run per-*domain* sub-agents (security, perf); we'd run per-*change-type* playbooks. Orthogonal lens, no observed overlap.
- **No-AI-authored-prose comments** (human writes cold, AI validates after) — all observed competitors do the opposite. Cloudflare explicitly: "coordinator posts a single structured review comment." Genuine wedge.
- **Private mind-map workspace** — none observed. All competitors surface AI work on the public PR thread.
- **Receipt-not-approval** semantics — none observed.

### Adjacency that narrowed
- **Delta brief / state-aware re-review.** Cloudflare's internal system already does state-aware incremental re-review at the *finding* level (auto-resolve fixed, re-emit unfixed, respect user-resolved unless worsened). Ours operates at the *comprehension* level ("what shifted in YOUR mental model"). Different unit but adjacent. Either:
  - Reframe positioning of delta brief as comprehension-layer-not-finding-layer, OR
  - Deprioritize it as a v1 differentiator if customers conflate the two.

### Strategic implication
The combined edges (intent taxonomy + playbooks + private engagement) place the MVP in a **different evaluation lane** than CodeRabbit/Greptile/Diamond/Qodo. Prospects compare us to the *status quo behavior* ("skim AI summary, click approve") rather than to incumbents. Avoids the second-mover trap of "is this just CodeRabbit but different?" Different mental model, different yardstick.

Trade-off: selling a new mental model is slower than selling a faster incumbent. Customer education cost is real.

### Why competitor absence is a weak signal (caveats to flag during interviews)
Five interpretations of "no competitor does this":
1. Genuine gap (best case).
2. Tried and failed — incumbents built it, users didn't pull.
3. Market doesn't reward it — customers loud-want "catch more bugs", quiet about "help me think". Tools follow loud signal.
4. Stealth / recent entrant not in search results.
5. Already exists inside something else (internal Cloudflare-style tools, JetBrains, GitLab Duo, etc.).

### Validation requirement during interviews
The edges are validated **only** when customers *spontaneously* describe wanting:
- Intent-tagging / change-type structure
- Per-category review structure
- A private place to think through a review
- A receipt of what the tool actually verified

If they describe wanting "better bug catching" instead, either the wedge is wrong, or right-but-described-differently — investigate which. Do not prompt toward the design; let customers reach for the structure themselves.

## Competitive Update — Linear Diffs (announced 2026-05-19)

Linear shipped a code-review feature inside their PM tool the day before this comparison. Pulled from https://linear.app/now/code-review-should-be-fast and https://linear.app/docs/diffs.

### What Linear Diffs IS
- New PR review surface **inside Linear** (PM tool), bidirectionally synced with GitHub. GH stays source of truth.
- **"Guided reviews / chapters"** — diff organized into chapters that follow "the order the work was reasoned through" (narrative sequence).
- **"Structural diff highlighting"** — strips formatting noise (whitespace, format-only changes).
- Unified or side-by-side diff toggle.
- AI involvement is present but the announcement is vague on what AI does; FAQ mentions labeling feedback.
- Wedge claim: review next to issue/project/customer context.

### Where we overlap (honest)
- Both leave the GH PR thread and build custom review surfaces.
- Both target reviewer experience, not bug-catching depth.
- Both group related chunks across files rather than presenting raw file-by-file diff.

### Where we differ — narrative vs taxonomic grouping

| Axis | Linear chapters | Our categorization |
|---|---|---|
| What the group IS | A *narrative* unit ("set up fixture", "fix the cache", "add regression test") | A *taxonomy* unit (`pure-move`, `lib-bump`, `schema-change`, etc.) |
| Labels are | PR-specific strings, different every PR | Stable taxonomy, same across every PR ever |
| Across-PR queryable | No (chapters are unique strings) | Yes (`schema-change` PRs in last quarter…) |
| Per-category playbook possible | No (chapters are unique per PR; nothing stable to attach playbook to) | Yes (the whole wedge) |
| Hard-case detection (e.g., `move-with-edits` hidden) | Often invisible — Linear groups by story, the move-with-edits pattern bundles into "test fixture setup" and the hidden edit is masked | Surfaced — taxonomy explicitly names the pattern |

**The two axes are orthogonal, not competing.** Narrative says *how the change is told*; taxonomy says *what kind of change it is*. A future Linear could add taxonomy on top of chapters; a future of ours could add narrative on top of categories. Neither subsumes the other today.

### Edges that remain unique to us
- Intent-based multi-tag categorization with stable taxonomy
- Per-category templated engineering playbooks
- No-AI-authored-prose comment rule
- Private mind-map workspace
- Receipt-not-approval semantics
- Delta brief on re-review
- Three-bucket risk surface

### Strategic read
- **Validation signal (positive).** A credible player shipping a non-GH review surface legitimizes the direction.
- **Distribution risk > feature risk.** Linear has captive users (their PM customers); we don't. They monetize PM seats; review is a feature, not a product — less likely to pour effort into comprehension scaffolding once "review next to issue context" boxes the wedge.
- **Positioning risk (medium).** Interview prospects on Linear may say "why not wait for Linear to add this?" Need a clean answer.
- **Tail risk.** If Linear ships intent taxonomy + playbooks in the next 6–12 months, our unique edges narrow materially. Worth watching.

### Required adjustments
- **Phase 1 interview script update.** Add explicit Linear probe to every interview: "Are you on Linear? Have you seen Diffs? Does it solve the pain you described, or no?" Capture their reaction verbatim — it's a key signal for both positioning and wedge survival.
- **Update positioning language.** From "the only one leaving the GH thread" to "the intent-aware comprehension layer with engineering playbooks — runs alongside your PM tool's review surface or native GH."
- **Watch Linear's roadmap.** Quarterly check. If they ship taxonomy/playbooks/risk surface — re-evaluate.
- **Reframe Linear as complement, not competitor in the pitch.** A future overlay of intent categories on top of their chapters is technically coherent. Don't bash them; differentiate axis.

### Verdict
Moderate risk, not stop-go. Proceed with Phase 1 with adjusted interview script. Most "is X going to kill us?" framings collapse when looked at by axis. Linear's axis is narrative; ours is taxonomic. They are different products solving overlapping pain.

### Update (2026-06-07) — overlap re-assessed after the change-group / LoC work

Designing change-groups + carrier/supporting + concern split + weighted LoC moved us **onto Linear's substrate**. Linear's own doc: *"surface the core parts of an implementation first while grouping supporting or lower-signal changes separately"* — that is carrier-vs-supporting. The grouping substrate is now **table stakes**, not a differentiator. This is the most overlap the product has had with Linear.

**What still does not overlap — the differentiator layer:** stable Category taxonomy, per-category engineering playbooks, risk-surface attributes, verification receipt, private mind-map. These ride *on top* of the grouping; they were never the grouping.

**Strategic reframe:** stop pitching grouping/core-supporting/LoC as differentiators — substrate everyone converges on. Defensibility = the non-obvious layer (playbooks-as-engineering-rules, cross-PR stable taxonomy, verification). If that layer isn't genuinely valuable, there's no moat, because grouping is free from Linear.

**Methodological consequence — adopted (replaces raw-diff baseline):** Phase 1 now tests **Treatment vs Baseline B′**, where B′ = grouped substrate with taxonomy/playbooks/risk-surface stripped (≈ Linear-equivalent). The delta isolates the differentiator layer. Raw-diff baseline dropped entirely — the "beats status quo" signal already exists; we test the harder, existential question (does our layer beat what Linear gives free?). See `phase-1.md`.

### Two-layer / dual-consumer model (formalized in CONTEXT.md, 2026-06-07)

- **Analysis Layer** (change-groups, taxonomy, playbooks, risk-surface, concern split, LoC) — reviewer-agnostic core; serves both humans and AI-agent reviewers. The true moat.
- **Engagement Layer** (no-AI-prose rule, private mind-map, seeds, human-written comments, approval + receipt) — human-only workflow.
- **Dual-consumer:** human reviewer consumes Analysis via Engagement (v1); AI-agent reviewer consumes Analysis directly via API (v1.5+ headless lead-in — confirmed NOT in first release). The no-AI-prose rule and mind-map are human-mode only; agent-mode inverts the prose rule by design.
- **Submission:** review lands natively on GitHub (comments + verdict) authored by the reviewer; a one-line signature links to a static **Review Summary** holding the receipt. Tool present but unobtrusive (ADR 0002, 2026-06-07 delivery refinement).

## Moat Honesty (2026-06-09)

Terminology fix across the docs: the taxonomy + playbooks + risk-surface layer is the **wedge**, not the moat. A moat is a structural defense that stops competitors copying you *after* the idea is proven (switching costs, network effects, proprietary data, distribution lock-in). A feature is not a moat.

**Why the old claim was soft:** taxonomy + playbooks are prompt engineering plus a markdown library — any competent team rebuilds them in weeks. CodeRabbit/Greptile can ship "change-type-aware checklists" in a sprint *once Phase 1/2 success proves the wedge works*; our validation becomes their spec. The docs previously watched Linear closely while underweighting incumbent copy speed.

**What could compound into a real moat (earned, not claimed):**
- **Data exhaust.** Every reviewer reclassification, dismissal-with-reason, and playbook-item visit is labeled training data nobody else has. It improves the categorizer; competitors start cold.
- **Org-learned playbooks (2026-06-09).** Preset playbooks are the commodity layer; the compounding layer is per-org playbook items mined from that org's own review activity on the platform — recurring review comments, dismissal reasons, flag-address patterns — summarized into suggested additions ("in this repo, `schema-change` also means check the analytics consumer"). Proprietary where it draws on in-platform exhaust (dismissals, reclassifications, item visits — invisible to competitors); only semi-proprietary where it draws on GitHub comment history (any installed tool can mine that). Guardrails: human-approve loop (tech lead accepts suggested items before they activate — consistent with the no-verdict ethos), org data never trains other orgs' playbooks, cold-start means this only pays after months of usage. Post-validation work; parked here as the concrete mechanism behind "data exhaust".
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
- **Fits useful-tool-first intent** (see Project Intent in `docs/problem-framing/initial.md`) — peers use it free, forever.

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

Lifted from `docs/problem-framing/initial.md` recommended next steps — these run in parallel with product scoping, not after.

1. **8–12 problem-discovery interviews** split across PR author, reviewer, tech lead, eng manager. Anchor on the rubber-stamp moment: "walk me through the last AI-authored PR you merged — where did you stop reading?" Goal: validate the *comprehension* gap (not the bug-catch gap) is the live pain.

   **Sequencing (2026-06-09): run ≥4 of these BEFORE the first Phase 1 reviewer session** — not in parallel. Interviews are the cheapest kill-test and may reshape PR selection and playbook content before labeling hours are spent. Phase 1 debriefs double as interviews (discovery questions appended *after* the review-task discussion — see `phase-1.md`), so net-new recruiting is ~4–6 people.

   **Full runnable script with probes, capture sheet, and synthesis gate: [`docs/interviews/script.md`](./interviews/script.md).** Outline:
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
