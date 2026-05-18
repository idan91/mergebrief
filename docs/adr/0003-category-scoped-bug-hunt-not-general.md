# Category-Scoped Checks Only, No General Bug Hunt

The tool does not run a general line-level AI bug-finder. The only "missed points" surfaced are structural gaps tied to the brief's categories and risk surface — playbook items not visited, risk-surface flags not addressed, category integrity regressions (e.g., a `pure-move` chunk gaining edits since last commit). Orchestrating competitor bug-finders (CodeRabbit, Greptile) is reserved as a v1.5 add-on.

## Considered Options

- **Build our own general AI bug-finder.** Rejected. Competing directly with Greptile (82% catch, noisy) and CodeRabbit (44%, clean) on a feature they've spent years tuning. A new team cannot match this, and it pulls the product into the crowded reviewer-bot lane — exactly the lane the wedge is positioned against. High cost, low edge.
- **Buy/integrate competitor output as the primary bug-hunt layer.** Rejected for v1. Workable as orchestration (ingest CodeRabbit/Greptile comments, dedupe against the reviewer's own, surface gaps) but creates a hard dependency on a competitor's API/output for the MVP's core experience. Reasonable as a v1.5 add-on once the wedge is established.
- **Skip bug-hunt entirely.** Rejected as too austere — loses the "missed points" feedback loop that's part of the reviewer-engagement story.
- **Category-scoped checks only** (chosen). The brief's categories already imply specific verification work per chunk; the tool checks whether the reviewer engaged with those category-specific obligations. "Missed points" becomes a structural claim (an item on a checklist not visited, a flag not addressed), not an AI bug verdict.

## Why This Way

The product's differentiation is comprehension scaffolding via diff-by-intent, not line-level bug catching. Adding a general bug-finder dilutes the wedge and forces head-on competition with mature incumbents. Scoping checks to the categories and playbooks already in the brief keeps the entire product internally coherent: every "missed point" is a structural fact about a category obligation, not an AI hypothesis about correctness — which sidesteps the AI-authoring-prose trap entirely (missed points are checklist items, not English sentences) and preserves the accountability principle (reviewer owns judgment; the tool reports mechanical gaps).

This also produces honest positioning. The tool is "a comprehension layer that runs alongside your bug-catcher of choice", not "the AI code reviewer that does everything". That positioning is itself the differentiation.

## Consequences

- Some prospects will expect any product with "code review" in its pitch to also catch bugs. Positioning must be clear and consistent: comprehension layer, runs alongside bug-catchers.
- The receipt's "not checked" section must always explicitly include "general bugs / correctness" so authors and managers know to run a bug-catcher if they want that lane.
- v1.5 orchestration of CodeRabbit/Greptile output is a viable expansion path once the wedge has established product-market fit — but it remains additive, not central.
- If a strong customer signal emerges that the missing bug-hunt blocks adoption regardless of positioning, revisit. Default answer remains no.
