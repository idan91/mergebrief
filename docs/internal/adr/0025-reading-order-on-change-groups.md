# Reading Order on Change-Groups

Every **Brief** may carry a **Reading order**: a strict permutation of its **Change-groups** — each group exactly once, no revisits — with a one-line *why-this-next* rationale per step. The rule is **foundation-first** (groups other groups build on come first: schema/types → core logic → call sites/wiring), falling back to **context-first, churn-last** for independent groups, keyed on Category (mechanically low-signal Categories like `pure-move`, `lib-bump`, `dependency-update` sink to the end). The order is emitted by the model **in the same generation call as the Brief**, as an optional `readingOrder` field, mechanically validated as a permutation of the emitted group IDs; invalid or absent degrades to the current structural order. The **Read-through** is the FE experience of following it.

## Context

Group order today is raw LLM emission order — the prompt gives no ordering instruction and the FE preserves source order. Within-group order is structural (carrier → supporting, fixed Concern order). CodeRabbit's Atlas ships dependency-ordered "layers," but PR-local, with no stable taxonomy underneath; our differentiated version is the reasoned order laid *on top of* the stable Change-group taxonomy (`docs/internal/oss-roadmap.md` P2, `docs/internal/competitive-analysis.md`). ADR 0005 fixed intent on the Change-group; ADR 0024 set the recent precedent of lean generated additions that attach to existing groups rather than creating parallel structure.

## Considered Options

- **Computed dependency order (code graph).** Rejected: real import/def-use analysis across languages is the semantic-graph arms race we explicitly don't chase; a cheap heuristic graph would be confidently wrong.
- **Generated order, mechanically validated (chosen).** The model orders groups while it is forming them — the dependency picture is already in its working memory. The mechanical guarantee is the permutation check, not the ordering judgment; same "generated explains, mechanical guarantees" split as ADR 0024.
- **Separate LLM call / sidecar artifact.** Rejected: unlike the Revision narrative (non-first Briefs only, cross-artifact span, independently failable, config-gated cost), the Reading order applies to every Brief and derives from inputs the Brief call already holds. A second call re-reads context the first call just had. Optional field on the Brief; absence degrades; old Briefs need no migration.
- **Layered order with revisits (Atlas-style "layers").** Rejected: one visit per group preserves "a reviewer never reviews the same lines twice"; a group that needs two visits is two Change-groups that were merged wrongly.
- **Importance ranking as the fallback for independent groups.** Rejected as vocabulary and as model: an importance rank is severity's cousin and breaks the no-verdict stance (ADR 0002; the rejected "critical areas" framing in ADR 0005). The fallback is a *comprehension* tiebreak — context-establishing groups first, mechanically-known churn last — keyed on Category where possible, with no score or rank label ever exposed.
- **A new grouping/sequence structure.** Rejected: the order is *over* existing Change-groups; a parallel taxonomy is the trap the Revision narrative already avoided.

## Frontend

- The **Story view adopts the Reading order as its group order** when present; the why-line renders as a step caption on the group header. No user-facing sort toggle. Absent/invalid order → today's structural order.
- **Read-through = existing focus mode + sequence awareness**: enter at step 1, focused group shows its why-line and position (n of N); `J`/`K` remain chunk-level; `Shift+J`/`Shift+K` step groups along the Reading order. No mode-dependent key semantics.
- **Concern view is untouched** (order-irrelevant attention router). Changes Only views inherit the order only via their full-Brief group headers.
- Scope: full **Brief** only. The Delta Brief's `changedGroups` never get their own Reading order.

## Consequences

- Brief schema gains optional `readingOrder: { groupId, why }[]`; post-parse validation (permutation of group IDs) warns and drops the field rather than failing the Brief — the `validatePartition` precedent.
- Prompt cost is marginal tokens on the existing call, not a new call — no config gate needed (contrast ADR 0024's narrative). Watch for attention dilution of the main Brief output during dogfooding; the escape hatch is moving to a second call later, which the optional-field shape does not preclude.
- `CONTEXT.md` gains **Reading order** and **Read-through**; `narrative`/`story` stay reserved for generated text, `walkthrough` (CodeRabbit) and `layers`/`cohorts` (Atlas) are avoided.
- The why-line is comprehension language under the no-verdict stance: "mechanical rename — read last," never "low importance." Nothing anywhere surfaces a rank or score.
