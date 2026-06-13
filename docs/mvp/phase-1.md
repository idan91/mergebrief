# Phase 1 — Wizard-of-Oz C Test

> **⚠ REDEFINITION REQUIRED before any labeling (2026-06-13 reshape — see [`center-of-gravity.md`](./center-of-gravity.md)).** This plan isolates the **playbook** layer (Treatment = taxonomy + playbooks + risk-surface vs Baseline B′ = grouping only). The reshape **demotes the playbook** — interview D, a senior, called it noise for experienced engineers, and that demotion is now a direction decision, not a hypothesis to test. Running the experiment as written would burn ~8 labeling hours validating a layer being hidden. **Redefine the experiment around the new center of gravity — does *story + risk-surface + delta* move reviewer behavior — before labeling any PRs.** The PR set, hand-labeling protocol, observation method, and pre-registration discipline below are reusable; the **Treatment/B′ conditions and success gate are not** until redefined. Treat everything past this banner as pending that rewrite.
>
> Original framing (retained for reference): confirm the differentiator layer (taxonomy + playbooks + risk-surface) moves reviewer behavior **beyond Baseline B′** — the grouped substrate (change-groups, carrier/supporting, concern split, LoC) that Linear Diffs already ships for free. Not tested against raw diff. Full plan and gating criteria in [validation-plan.md](./validation-plan.md).

## Working PR Set

Curated open-source PRs for hand-labeling. Picked for: manageable size (~4–12 files, ~80–400 additions), category mix (exercises the multi-tag taxonomy), public reviewability (no permission negotiation), and well-known repos (some reviewers will have context).

### Primary PR — medusa #15605

**Title:** validate http(s) scheme on fulfillment label URLs
**URL:** https://github.com/medusajs/medusa/pull/15605
**Size:** 8 files, +77/−17
**Stub:** `briefs/medusa-15605.md` (+ `medusa-15605.baseline.md` for B′)

**Why this PR for the first hand-label pass:**
- **Self-explanatory from the diff alone** — the concept ("only accept `http:`/`https:` URLs; still allow empty + `#`") needs zero library-internals knowledge. The right difficulty to *calibrate the process* before harder PRs.
- **No moves** — adjusted LoC ≈ git LoC, so the labeler isn't fighting move/edit separation on their first pass.
- **Clean dominant `new-feature`** (a shared `safeHttpUrl` validator applied across endpoints), with a legitimate `new-feature`-vs-security-hardening framing tension that makes a good inter-rater test point.
- **Three concerns naturally:** implementation (validator + 2 call sites + FE adoption) / test (unit + integration + fixtures) / doc (the `.changeset`).
- **Generalist-gradable tricky-cases:** the empty/`#` carve-outs, all-call-sites coverage, and whether the test asserts *rejection* of bad schemes (not just acceptance).
- BE-primary with one FE touch; not a bugfix, not bespoke config.

**Anticipated structure (to validate during hand-label):**

Likely a **single Change-group** — one intent: enforce http(s) on the fulfillment/label URL fields. Verify against the boundary rule (one Summary + one Dominant Category).

- **Group 1 — "enforce http(s) on fulfillment/label URLs"** · dominant `new-feature` (or security-hardening — labeler's call)
  - **Carriers:** `common.ts` (+20, the `safeHttpUrl` refinement), `fulfillments/validators.ts` (+3/−3), `orders/validators.ts` (+3/−3), `order-fulfillment-section.tsx` (+11/−1, FE adoption) — Concern `implementation`.
  - **Supporting:** `common.spec.ts` (+24), `fulfillment/index.spec.ts` (+8/−8), `fixtures/fulfillment/index.ts` (+2/−2) — Concern `test`. `.changeset/warm-rockets-laugh.md` (+6) — Concern `doc`.

Intent lives on the group; the test/doc chunks *support* it — not independently categorized.

**Concern view (anticipated LoC split):** implementation moderate, test moderate, doc tiny. No moves to exclude — a clean baseline calibration of the concern split.

**Playbook items to test against this PR:**

- dominant Category (`new-feature` if not yet in `playbooks.md`, draft it) → new capability is actually wired into every intended call site; carve-outs (empty, `#`) are intentional and tested; no unintended behavior change to adjacent fields.
- `test` Concern checks (supporting) → unit test asserts rejection of bad schemes, not just acceptance; integration test exercises the real endpoint path.

> Note: `new-feature` has no playbook yet. Expect to draft it during this label (see Labeling Scratch guidance in the stub). This is the opportunistic-expansion path working as designed.

### Backup PR — drizzle-orm #5331

**Title:** [drizzle-kit][MySQL]: Refactor introspection logic to use batch queries in mysql for improved performance and add progress callbacks for better tracking
**URL:** https://github.com/drizzle-team/drizzle-orm/pull/5331
**Size:** 5 files, +254/-146

**Why this PR for the second hand-label pass:**
- Title explicitly bundles `logic-refactor` + `new-feature` (progress callbacks) — exercises a different multi-tag combination than #93940.
- Performance-motivated refactor — tests the `logic-refactor` playbook's "behavior preserved" check at a non-trivial scale.
- Drizzle is a schema-aware library, so peripheral risk-surface flags (mutates state, external IO, schema-adjacent) likely fire.
- Heavier than #93940 — use only after you've calibrated the hand-label rhythm on the lighter case.

(Full file-by-file anticipated categorization to be filled in during the second pass — left blank intentionally so the labeler arrives without prior anchoring.)

## How to Find More Candidates

When extending beyond zod #5926 and the candidates above, use this query against any well-known repo. Adjust the size filters as needed. Found via this exact scan: `colinhacks/zod#5926`, `react-hook-form#13420`, `trpc#7262`, `remix-run/react-router#15101` (lib-bump candidate).

```bash
gh pr list --repo <owner>/<repo> --state merged --limit 50 \
  --json number,title,additions,deletions,changedFiles \
  --jq '.[] | select(.changedFiles >= 4 and .changedFiles <= 12 and .additions >= 80 and .additions <= 400) |
        "#\(.number) | files:\(.changedFiles) | +\(.additions)/-\(.deletions) | \(.title)"'
```

Then inspect a candidate:

```bash
gh pr view <pr-number> --repo <owner>/<repo> \
  --json title,body,additions,deletions,changedFiles,files \
  --jq '{title, additions, deletions, changedFiles, files: [.files[] | {path, additions, deletions}]}'
```

**Repos to source from** (good signal-to-noise for varied change types):

- `vercel/next.js` — heavy mix of bugfix, refactor, perf, test, infrastructure.
- `drizzle-team/drizzle-orm` — schema, refactor, lib bumps with breaking changes.
- `shadcn-ui/ui` — UI feature work + CLI tooling changes.
- `vercel/turbo` — bundler/build-system changes, perf-driven refactors.
- `tanstack/query` — type-system changes, API additions, deprecations.
- `prisma/prisma` — schema migrations + adapter library bumps.
- `microsoft/TypeScript` — language additions, internal refactors, deeply categorized changes.

## PR Set Composition

**Three tracks, ~9 PRs total:**

- **Track 1 — Gate evaluation set: 6 PRs.** Clean dominant categories, distributed across the taxonomy. Reviewer sessions run on these. PRs are *reused* across reviewers — same PR appears in Treatment for Reviewer A and Baseline B′ for Reviewer B, counterbalanced. Each reviewer sees ~4 of the 6, never the same PR twice.
- **Track 2 — Taxonomy stress-test set: 2 PRs.** Deliberately picked because they don't fit the taxonomy cleanly — mixed-category-no-dominant, or change types the taxonomy doesn't cover, or unusually shaped PRs (monorepo-spanning, vibe-coded experimental, etc.). Hand-labeled by you only, no reviewer sessions. Output: a list of taxonomy gaps to feed Phase 2.
- **Track 3 — Re-review / delta-brief probe: 1 PR.** One PR with real follow-up commits in its history. Label the brief at the base SHA, then hand-build the **Delta Brief** for the follow-up push (new chunks tagged, flag resolution status, playbook delta). Run with 2–3 of the reviewers in two sittings: initial review at SHA1, then return with the delta brief at SHA2. Observe: do they check the regressed / unaddressed items, or skim-approve on the back of their prior review? Rationale: `initial-scope.md` names re-review after follow-up commits the *hardest* rubber-stamp pool and the delta brief a v1 must-have — without this track the claimed-hardest pain has zero Phase 1 coverage. Directional probe, not part of the pre-registered gate. Cost: ~2 extra labeling hours.

**Target distribution across the 6 gate PRs:**

| Category | Target count (in 6-PR gate set) |
|---|---|
| `bugfix` | 2 (dominant) |
| `logic-refactor` | 1 (dominant) |
| `lib-bump` or `dependency-update` | 1 (dominant) |
| `move-with-edits` | 1 (dominant — the hard-case category, critical to include) |
| `new-feature` or mixed (e.g., `new-feature` + `test-only` secondary) | 1 (dominant) |

`test-only`, `config-only`, `schema-change`, `pure-move`, `generated-code` are not targeted as dominant in this set; they will appear as secondary categories across the 6 PRs (most PRs naturally include test-only and config-only sections). Coverage of playbooks for those categories is therefore tested without burning a slot.

Total labeling labor: ~6 hours for gate set + ~2 hours for stress-test = ~8 hours, completable in 1–2 sittings.
Total observation labor (your side): ~7 hours of session + debrief work across 3–5 reviewers.

## Playbook Library

Categories that fire in a hand-labeled PR pull their items from the shared **Playbook Library** at [`playbooks.md`](./playbooks.md). Initial subset covers `bugfix`, `logic-refactor`, `lib-bump`, `test-only`, `move-with-edits`. Additional categories drafted opportunistically as labeling encounters them.

## Risk Surface Library

Risk-surface attributes pulled from the **Risk Surface Library** at [`risk-surface.md`](./risk-surface.md). Three-bucket structure: about the code, about the change, about the blast radius. Hand-labeler asks one question per bucket per chunk. Combinations of attributes signal severity; individual attributes never do.

## Hand-Labeling Protocol

For each PR in the set, produce a labeled artifact that mirrors what the production tool will eventually generate. This artifact is what reviewers will see in the Phase 1 wizard-of-Oz test.

For each PR, capture:

1. **Chunk inventory.** A chunk is a contiguous run of changed lines sharing **one Concern and one Change-group** — sub-file, possibly finer than a git hunk. Split a file (or hunk) into multiple chunks when its parts differ in concern or intent; the only thing you can't split is multiplicity interleaved line-by-line within one inseparable span (capture that via secondary Category + Summary prose — the deferred sub-op tree). For each chunk capture:
   - **Concern** — `implementation` / `test` / `doc` / `spec` / `config` / `generated` (mostly from file path).
   - **Role** — `carrier` or `supporting` (default: `implementation` → carrier, else → supporting; flip when a supporting artifact is itself the purpose).
   - **Adjusted LoC** — `+added/−deleted` excluding moved & generated lines; note moves as `moved N`, generated as collapsed.
   - **Risk-surface attributes** — zero or more from `risk-surface.md` (`touches-auth`, `no-tests`, `mutates-state`, etc.).
2. **Change-groups.** Cluster chunks into groups using the boundary rule: one group = largest chunk set expressible as ONE Summary + ONE Dominant Category. Commits are a hint, not a boundary. For each group:
   - **Summary** — 1 descriptive sentence. *What* the group changes, not *why*. (Why belongs in the PR description / issue — narrative drift collapses the wedge into Linear's lane.)
     - Good: "Cache.ts scopes prefetch params per-route-segment instead of leaking across segments."
     - Bad: "Elegantly fixes a long-standing cross-segment caching bug by isolating the param scope."
   - **Categorization** — dominant Category + secondary (zero or more). Intent lives on the group, carried by the carrier chunk(s); supporting chunks serve it and are NOT independently categorized.
   - **Playbook** — items for the dominant Category, copied verbatim from `playbooks.md`. Plus supporting-Concern checks for the group's test/doc/spec chunks.
   - **Adjusted LoC** — rolled up across the group's chunks.
3. **Concern view.** Roll up adjusted LoC per Concern across the whole PR — the implementation-vs-scaffolding attention split.
4. **Tricky-cases note** — anything subtle a non-engaged reviewer would miss (move-with-edits, behavior-preservation drift, regressions in adjacent paths). Pre-register BEFORE reviewer sessions; freeze once written. This is what the playbook items should drive the reviewer toward.

## Reviewer Composition (Senior-Only)

Phase 1 recruits **3–5 senior / staff / tech-lead engineers**. Junior cohort explicitly deferred.

Rationale:
- Senior reviewers are the *hardest* to move — refined review instincts, less likely to rubber-stamp from inexperience. If the brief moves their behavior, the wedge is real. If it doesn't move them, the wedge is wrong for the ICP regardless of how juniors respond.
- Closer to product persona (eng manager / tech lead / staff eng) — the buyer needs to feel value first.
- The DORA-confirmed rubber-stamp pool that the product targets is largely senior engineers approving small followup commits and AI-authored chunks they don't deeply read. That's the case to test.

**Phase 1.5 (gated on Phase 1 passing):** add a 3–5 junior cohort to test the **skill-atrophy positioning angle** (see post-framing addendum in `docs/problem-framing/initial.md`). If the brief + playbooks help juniors stay sharp / build domain knowledge, that's a secondary product narrative — but not a primary validation gate.

## Comparison Method (Within-Subject)

Same reviewer reviews multiple PRs, half with the full **Treatment** brief, half with the **Baseline B′** rendering.

**The two conditions isolate exactly the differentiator layer:**
- **Treatment** — full brief: change-groups, carrier/supporting, concern split, adjusted LoC, descriptive summaries, **+ Category taxonomy + playbooks + risk-surface**.
- **Baseline B′** — same brief with the three differentiator fields **stripped**: no Category labels, no playbooks, no risk-surface. Everything else (groups, carrier/supporting, concern split, LoC, summaries) is identical.

The delta between conditions is therefore *only* {taxonomy + playbooks + risk-surface}. This is a deliberately **harder, more honest baseline** than raw diff: it grants the grouping substrate that Linear Diffs already ships for free (see `next-steps.md`), so the test measures the *marginal* value of your layer, not the bundle. We do not test against raw diff — the "beats status quo" signal already exists; spending effort on a baseline we won't ship would be waste.

- **B′ is generated from the full brief by hiding three fields** — one labeling effort produces both renderings. No double labeling.
- **3–5 reviewers** total. Realistic to recruit from peer network for a kill-test (Phase 1 is directional, not clinical).
- **Counterbalance order** — alternate which PR gets Treatment first across reviewers. Removes order effects.
- **Pair PRs of similar size/complexity** for fair comparison across the two conditions.
- **Capture carryover signal explicitly** in the debrief — ask each reviewer post-session: "did the Treatment brief from PR-1 change how you reviewed PR-2?" Carryover is itself a positive signal (the layer imprinted).
- Split-cohort (separate Treatment / B′ groups on the same PR) is rejected for Phase 1 — recruitment cost too high; saved for Phase 2 if needed.

## Observation Method (Async Record + Debrief)

Two-touch protocol per reviewer per PR:

1. **Async screen recording.** Reviewer records themselves silently going through the PR (Loom / QuickTime). No think-aloud required — captures real behavior without observation-effect distortion. ~10 minutes per PR on the reviewer's schedule.
2. **15-minute live debrief.** You watch the recording at 2× speed beforehand and identify 3–5 moments worth probing. Debrief covers: "what made you slow down here", "did you notice X", "would you want this on every PR", plus the time-acceptability questions from the guardrail ("worth the extra time?").

Total: ~25 minutes per reviewer per PR, half async on their side.

**Debrief doubles as a discovery interview.** After the review-task discussion is done (never before — anchoring), append 10 minutes of discovery questions from the interview script (`next-steps.md`, PMF track #1): last AI-heavy PR walkthrough, bug-that-got-through story, re-review habits, tools tried, Linear probe. Each Phase 1 reviewer then counts toward the interview quota, cutting net-new recruiting to ~4–6 people.

Rejected for Phase 1:
- Live think-aloud (Zoom + narration) — too expensive, distorts behavior via narration overhead.
- Async recording without debrief — loses the *why* signal needed to refine playbooks for Phase 2.
- Post-session survey only — no process signal; can't distinguish "brief helped" from "this reviewer is naturally thorough".

## Success Metric (Pre-Registered Gate)

The Phase 1 gate ("the differentiator layer moves behavior beyond B′") is operationalized as a **primary + confirmation** structure. Pre-register the hard cases per PR and the thresholds *before* observation sessions begin — moving goalposts after seeing data is forbidden.

**Note the bar is higher than the old raw-diff design.** B′ already grants grouping + carrier/supporting + concern split, so B′ will catch *more* hard cases on its own than a raw diff would. Expect a smaller Treatment-vs-B′ gap. The gate is that a **real, repeatable gap still exists** once grouping is held constant — that is the existential question (does your layer add value over what Linear gives free?). A null result here means grouping was the whole value and you have no moat.

**Phase 1 passes if:**
1. **Primary — hard-case detection delta over B′.** Treatment catches meaningfully more pre-identified hard cases (the per-PR "tricky-cases note") than B′, for the same reviewers. Absolute thresholds are set at the pilot session (first session calibrates given the stronger baseline; subsequent sessions are bound by it). The gap — not a fixed 60/30 — is what's pre-registered after pilot.
2. **Confirmation — at least two of three families show positive signal:**
   - **Process signal:** ≥3/5 reviewers visibly use the taxonomy/playbook structure (not present in B′) in the recording.
   - **Output signal:** Treatment reviews contain on average ≥2 playbook-derived checks per PR that B′ reviews lack.
   - **Self-report signal:** ≥3/5 reviewers report the taxonomy/playbook layer changed behavior in debrief AND ≥3/5 say "would want this on every PR."

**Guardrail — time cost (not part of the gate, but can downgrade it).** Log wall-clock review time per PR per condition from the screen recordings (already captured — zero extra cost). Treatment is *expected* to take longer — engagement costs time — so the guardrail is acceptability, not parity. In every debrief ask: "was the extra time worth it?" and "would you spend this on every PR?" If Treatment wins on detection but ≥3/5 reviewers call the time cost unacceptable for daily use, the result is **ambiguous**, not a pass — the layer works but the friction must shrink before Phase 2.

**Phase 1 fails if** Treatment shows no detectable hard-case gap over B′ regardless of confirmation — i.e., the differentiator layer adds nothing beyond grouping.

**Phase 1 is ambiguous if** primary is weak but confirmation is strong → run more sessions (more PRs, more reviewers) before concluding either way.

**Pre-registration discipline:**
- Hard cases per PR are written in the brief's `Tricky-Cases Note` *before* sessions.
- The Treatment-vs-B′ gap threshold is committed at the pilot session and not adjusted retroactively.
- A "comment matches a hard case" judgment is made by reviewing the reviewer's comment text against the tricky-cases note — done by you (the labeler) consistently across both conditions.
- **Score blind.** You are labeler, scorer, and hypothesis-holder — bias risk is real. Mitigate: collect all reviewer comments first, strip condition identifiers (Treatment vs B′) from the comment sets, score every comment against the tricky-cases notes in one sitting, then unblind. Do not score session-by-session with conditions visible.
- **Don't reveal which condition is "yours."** Reviewers come from your peer network and will perform engagement if they know which rendering you're rooting for. Frame both renderings neutrally ("two formats we're comparing").

## What to Track During Reviewer Observation

Once the hand-labeled artifacts are ready and reviewers are recruited, observe behavior on these axes:

- **Engagement** — does the reviewer read the playbook items, or skim past them like they skim AI CR comments today?
- **Navigation** — do they use the category tags to choose where to focus? Or do they scroll the diff linearly as in raw GitHub?
- **Hard-case detection** — does the move-with-edits playbook surface the hidden edit? Does the bugfix playbook drive them to check adjacent paths?
- **Spontaneous mentions** — do they reach for category/playbook structure unprompted? ("Where's the [category] item?" or "Was anything moved?" are gold-standard signals.)
- **Dismissals** — when they dismiss a playbook item or risk-surface flag, do they articulate a real reason, or do they wave it off?
- **Comparison vs Baseline B′** — same reviewer, similar PR with the stripped B′ rendering (grouped substrate, no taxonomy/playbooks/risk-surface). Measure the delta on each axis above. The delta isolates the differentiator layer.

## Brief Storage and Reviewer Access

Briefs live in `docs/mvp/briefs/` as markdown files — one file per PR. The repo stays **private** for now.

Reviewer access model:
- **Default:** add reviewer as a read-only collaborator on the repo (GitHub). Share the GH-rendered markdown URL for the specific brief.
- **Fallback:** for any reviewer who refuses or can't use GitHub, copy the brief markdown into a Notion page or send as a `.md` file via DM. One-off, not a pipeline.

Naming convention: `docs/mvp/briefs/<repo>-<PR-number>.md` (full Treatment brief). The **Baseline B′** rendering lives alongside as `<repo>-<PR-number>.baseline.md` — the same brief with Category labels, playbooks, and risk-surface stripped (groups, carrier/supporting, concern split, LoC, summaries retained). Generated from the full brief, not labeled separately.

## Open Questions for Phase 1

Still unresolved — to drill in subsequent grilling sessions:

- **Labeling labor budget.** Estimated ~8 hours total for the gate + stress sets. Worth front-loading (label everything before any sessions) vs interleaving (label batch 1, run sessions, label batch 2)?

Resolved (logged inline above):
- ~~Comparison method~~ → within-subject, counterbalanced, 3–5 reviewers
- ~~Recording / replay~~ → async record + 15-min debrief
- ~~Success metric~~ → primary (hard-case detection delta) + confirmation (≥2 of 3 families), pre-registered
- ~~Risk-surface attribute taxonomy~~ → three-bucket starter set in `risk-surface.md`, expand opportunistically
- ~~Reviewer recruitment composition~~ → senior-only Phase 1; junior cohort deferred to Phase 1.5 gated on Phase 1 pass
- ~~PR selection bias~~ → two-track split: 6 clean gate PRs (reviewer sessions) + 2 stress-test PRs (taxonomy gap-surfacing, no reviewers)
- ~~Where brief docs live~~ → `docs/mvp/briefs/` in this (private) repo; reviewers added as read collaborators; Notion fallback only for refusers
