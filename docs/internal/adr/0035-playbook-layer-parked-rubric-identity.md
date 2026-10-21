# 0035: Playbook Layer Parked to v2; Rubric Identity Locked

Status: accepted

The per-Category Playbook / per-Concern check layer is **parked to v2** (grill,
2026-07-23). All product-code mentions are removed; the markdown library
(`docs/internal/mvp/playbooks.md`) is kept in place as the v2 seed. The contribution commons
retargets to the **taxonomy + risk-surface vocabulary** — the part the engine actually
consumes. The identity a revived playbook layer must have is locked here so v2 does not
re-litigate it: a **coverage rubric — measurement, never instruction**.

## Context

- The 2026-06-13 reshape demoted Playbooks from human headline to "agent-facing +
  optional junior UI". In practice the demotion went further than the docs admitted:
  at park time **nothing consumed them**. Verified: `CATEGORY_PLAYBOOKS` in
  `apps/web/src/features/brief/playbooks.ts` had zero imports; the check-off spine
  (`checkPlaybookItem`, `CheckBucket` carrier buckets, `playbookChecked/Total`
  progress counters, persisted `checkedItems`) was UI-orphaned; playbook items
  generated no Flags (contrary to the Flag description); the engine prompt never referenced
  playbooks. The layer existed only as markdown plus dead/dormant code.
- The junior-reviewer case was rejected: juniors learn from stories and change-groups
  like everyone else; a checklist does not teach. Juniors-as-market carries no weight
  (useful-tool-first framing).
- The decisive risk: playbook items consumed as *prompt material* for review agents
  behave like a bad `CLAUDE.md` — static instruction text that silently steers, rots,
  and constrains improving models. A wrong bullet would skew every review of that
  Category, invisibly. Over-showcasing, under-covering, and wrong items all share this
  failure mode when consumption is prompt-side.
- Launch-path discipline: v1 is already detail-heavy; the layer's only launch-day value
  was as a reference document. Same park logic as ADR 0033 (providers parked to v2).

## Decision

### 1. Parked, not killed

- `docs/internal/mvp/playbooks.md` stays, headed with a parked-status note. Content remains the
  v2 seed; no new items accepted while parked.
- All playbook mentions leave the product code (FE constants, dormant check-off spine,
  progress counters, marketing copy). Separate code PR; this ADR is the authority.
- `CONTRIBUTING.md` retargets its pitch to the taxonomy + risk-surface commons
  (Categories / Concerns / Risk-Surface attributes — engine-consumed via closed enums
  and prompt descriptions). Playbook contribution sections are removed; risk-surface
  "Playbook implication" fields rename to "Reviewer implication".

### 2. Rubric identity (binding on any v2 revival)

A revived playbook is a **coverage rubric**: it defines what a *complete* review of a
given change type covers. It measures finished reviews; it never instructs reviewers or
agents beforehand.

**Consumption contract — never-in-prompt:** playbook items MUST NOT be injected into
generation prompts or agent system prompts, by us or by integrators (documented as an
anti-pattern). Permitted consumption is post-hoc only:

- optional human check-off, frozen into the Receipt as a coverage statement
  ("5/6 items addressed; lockfile check skipped — reason given");
- grading/attestation of a finished review (human or AI) against the rubric.

A rubric cannot bias what it never touches; this contract structurally removes the
bad-`CLAUDE.md` failure mode rather than mitigating it.

### 3. v2 consumer candidates (direction, not commitment)

1. **Receipt coverage line** — cheapest; the (removed) check-off spine sketched it.
2. **Agent-review grading** — "your agent's review of this lib-bump never addressed
   the changelog's breaking changes." Authorship-neutral by construction.

### 4. Governance retarget

The parking grill's WHO-DECIDES question survives the park and gets *sharper*: token changes
(Category / Concern / Risk-Surface) rewrite the generation prompt and output schema —
higher stakes than any doc item. Governance for the **taxonomy commons** remains
launch-blocking (before OSS cutover); the eval harness is the
candidate review gate for token PRs. Successor ticket carries this.

## Revisit triggers (any one fires → unpark grill)

1. An outside contributor submits playbook-shaped content despite the park.
2. A real demand signal for grading/attesting agent reviews.
3. Receipt-coverage pull from actual users post-launch.

## Consequences

- Launch surface shrinks; the commons pitch is honest again (it advertises only what
  the engine consumes).
- The Flag model is risk-surface-only in v1; the Flag description in `CONTEXT.md` is
  corrected accordingly.
- If v2 revives the layer, the check-off spine must be rebuilt — deliberate: dormant
  code kept "for later" was masquerading as product truth.
