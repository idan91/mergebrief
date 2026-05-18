# Next Steps

Running list of items to revisit in future sessions. Grouped by type.

## Unresolved from Grilling Session (2026-05-19)

These four items came up during the reviewer-side scope grilling but were deferred — they need their own focused conversation.

1. **Pricing model and ICP.** Who's the buyer (eng manager, tech lead, IC, CISO)? Seat-based or org-based? Free tier shape? What's the per-seat price target relative to CodeRabbit ($24/dev), Graphite Diamond ($40), Greptile? Pricing follows whoever felt the pain enough to pull out a card during interviews.
2. **"Uncertain" threshold calibration.** When does the AI label its category/flag output as `uncertain`? Per-category threshold (some categories are easier to classify than others)? Per-playbook? Single global threshold? Tied to model confidence score or to disagreement between multiple passes?
3. **Two-reviewers-same-flag UX.** When two reviewers dismiss the same flag with different reasons, what does the receipt show — both reasons attributed, latest only, or some merged form? UX detail but matters for multi-reviewer audit trail.
4. **Bottoms-up POC flow for individuals.** Onboarding assumes admin installs the GH App org-wide. How does a single curious reviewer try the tool on their personal repos before pitching it upward? Distribution path for grassroots adoption.

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

## PMF Validation Track (from Problem Framing)

Lifted from `docs/problem-framing/initial.md` recommended next steps — these run in parallel with product scoping, not after.

1. **8–12 problem-discovery interviews** split across PR author, reviewer, tech lead, eng manager. Anchor on the rubber-stamp moment: "walk me through the last AI-authored PR you merged — where did you stop reading?" Goal: validate the *comprehension* gap (not the bug-catch gap) is the live pain.
2. **Survey ≥100 devs** measuring % of AI-authored PRs they (a) understood fully before approving, (b) approved with reservation, (c) approved without engaging. Sizes the rubber-stamp rate quantitatively.
3. **Audit 3–5 existing tools** (CodeRabbit, Graphite Diamond, Qodo, Copilot PR review, Claude Code Review) on the author-side / pre-review / comprehension axis specifically. Score depth, friction, adoption. Map the gap.
4. **Sketch a wedge experiment.** Smallest possible "pre-review comprehension brief" an author runs on their own diff before requesting review. Test if (a) authors run it voluntarily, (b) reviewers report changed behavior.
5. **Pricing/ICP probe** (overlaps with #1 above). Which persona felt the pain enough to pull out a card?
6. **Decide v1 framing.** Build a *new product* (own surface — current direction), a *layer* inside an existing PR tool, or an *IDE-side* author-prep tool. Each implies different distribution and moat. Confirm current decision (web app + GH bridge) survives interview feedback.
