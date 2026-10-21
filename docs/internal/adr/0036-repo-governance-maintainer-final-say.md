# 0036: Repo Governance: Maintainer Final Say, With Receipts

Status: accepted

Governance for the whole repository — code, vocabulary, direction — is settled ahead of
the OSS cutover so the rules exist before contributors arrive (governance
grill, 2026-07-23). The model is deliberately minimal: **the maintainer has final say on
everything, and every substantive decision leaves a written reason.** Loosening is a
future decision with recorded triggers, not a launch feature.

## Context

- The project is maintained by one person. Any governance model describing more than
  that (tiered trust, lazy consensus, voting) would be fiction at launch, and fiction
  in governance docs is where contributor disputes start.
- Vocabulary changes carry the highest stakes: Category / Concern / Risk-Surface tokens
  are closed sets wired into the engine's prompt and output schema — accepting a token
  changes every Brief for every user. (ADR 0035 retargeted the governance
  question here after parking the playbook layer.)
- A bot-gated model was considered and is structurally impossible for outside PRs: the
  eval harness costs live API spend and needs the maintainer's key, which
  fork PRs never receive. The harness is the maintainer's instrument, not an
  autonomous gate.
- Evidence bars already exist in the docs and stay as the published yardsticks:
  ≥2-real-PRs + reviewer-implication rule for risk-surface attributes
  (`docs/vocabulary/risk-surface.md`), deprecation-by-evidence (never fires across 10+ PRs /
  constant co-fire), the parked-candidates lane as the standard soft-no, and the
  Concern-vs-Category confusion check (`test-only`/`config-only` precedent).

## Decision

### 1. Final say

The maintainer decides accept / reject / park for every contribution — vocabulary,
code, docs, direction. Stated plainly in `CONTRIBUTING.md`; no soft wording implying a
committee or process that does not exist.

### 2. Receipts

Every substantive accept, reject, or park gets a short written reason in the PR (or
issue) thread, referencing the published bars where they apply. The receipt is what
makes single-maintainer rule legible rather than arbitrary: "rejected — no second
real-PR example", "parked — needs repo context the engine doesn't have (see
risk-surface.md parked candidates)". No separate decision-log file; the PR thread and
the `labeling-schema.md` status column are the record.

### 3. Vocabulary mechanics (recorded, not new)

Token changes are generation-surface changes by definition: they are merged only after
a **maintainer-run** eval harness pass, with the report in the PR body (existing
eval-harness convention gate). Contributors are told explicitly that this step is
maintainer-side — acceptance waits on it, and they cannot run it themselves.

### 4. Disputes

Discussion happens in the PR or issue. Convincing the maintainer is the process.
"Parked" is the standard soft-no for good-ideas-not-yet. No appeal machinery, no
auto-accept timers, no promised response times.

## Loosening triggers (any one fires → revisit this ADR)

1. A second contributor sustains quality contributions long enough that maintainer
   rights are worth discussing.
2. Review latency becomes a real bottleneck for willing contributors.
3. A first genuine governance dispute shows the model failing in practice.

Until one fires, this ADR is the whole model.

## Consequences

- `CONTRIBUTING.md` §Governance states the model in plain language ("final call rests
  with the maintainer") — authorship-neutral, no governance jargon.
- Contributor expectations are honest from day one: evidence in, written reason out,
  one decider.
- The cost is bus-factor honesty: this model documents, rather than hides, that the
  project currently depends on one person. The loosening triggers are the answer, not
  pre-built machinery.
