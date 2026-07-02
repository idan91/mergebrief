# Plan — Reading Order and Read-Through (P2)

> Status: **approved, ready to implement.** Created 2026-07-02.
>
> Purpose: give every Brief a **Reading order** — a reasoned sequence over its
> Change-groups — and a **Read-through** experience that follows it. This is
> roadmap P2 ("narrative-on-top-of-taxonomy"): the ordering Atlas ships as
> PR-local "layers", built instead on our stable Change-group taxonomy.

Grounded in: `CONTEXT.md` terms **Reading order**, **Read-through**,
**Change-group**, **Category**, **Summary**; ADR 0025 (the controlling
decision), ADR 0005 (intent on Change-group, two-view projection), ADR 0024
(precedent: generated additions attach to existing groups).

## Reference ADRs

| ADR | Role | Why it matters here |
| --- | --- | --- |
| [ADR 0025 — Reading Order on Change-Groups](../adr/0025-reading-order-on-change-groups.md) | **Main / controlling** | The ordering rule, permutation constraint, same-call generation, degrade path, and FE shape. |
| [ADR 0005 — Intent on Change-Group](../adr/0005-intent-on-change-group-two-view-projection.md) | Supporting | Change-groups own intent; Story view pivots by group — the surface the order reorders. |
| [ADR 0024 — Comparison Baselines and Revision Narratives](../adr/0024-generated-revision-narrative.md) | Supporting | "Generated explains, mechanical guarantees" split; lean-addition precedent; Changes Only group headers inherit the order. |
| [ADR 0013 — Provider-Agnostic Generation and BYOK](../adr/0013-provider-agnostic-generation-and-byok.md) | Supporting | Generator boundary; the order rides the existing Brief call (marginal tokens, no new call). |

## Decisions Locked During Grilling (ADR 0025)

| Decision | Resolution |
| --- | --- |
| Shape | Strict permutation over existing Change-groups; each group once, no revisits; one *why-this-next* line per step. Never a new grouping. |
| Rule | Foundation-first (schema/types → logic → call sites/wiring); independent groups fall back to context-first/churn-last, keyed on Category. |
| No-verdict | No importance/priority/severity rank or score, ever. Why-lines use comprehension language. |
| Production | Emitted in the Brief's own generation call as optional `readingOrder`; no second call, no config gate. |
| Validation | Mechanical permutation check post-parse; invalid/absent → warn, drop field, degrade to structural order. Never fails the Brief. |
| Terms | **Reading order** (data) + **Read-through** (experience). Avoid: narrative, story, walkthrough (CodeRabbit), layers/cohorts (Atlas). |
| FE | Story view adopts the order (why-line as step caption, no sort toggle); Read-through = focus mode + sequence; `J`/`K` chunks, `Shift+J`/`Shift+K` groups; Concern view untouched; full Brief only. |

## Implementation Sequence

### Stage 1 — Categorizer: schema, prompt, validation

1. **Schema** (`tools/categorizer/src/types.ts`): optional field on the Brief —

   ```ts
   readingOrder?: { groupId: string; why: string }[]
   ```

   Zod: optional array, strict step objects. Absence is valid.

2. **Prompt** (`tools/categorizer/src/prompt.ts`, Brief system prompt): add a
   Reading order section to the existing Brief instructions (same call — do
   NOT add a new prompt builder):
   - Emit `readingOrder` as a permutation of the emitted `changeGroups` ids.
   - Rule: foundation-first; where groups are independent, context-first /
     churn-last — groups whose Dominant Category is mechanical (`pure-move`,
     `lib-bump`, `dependency-update`, generated churn) go last.
   - `why`: one line, at most ~15 words, comprehension language
     ("establishes the schema the rest builds on"; "mechanical rename — read
     last"). Never importance/priority/severity words, never scores.
   - Applies to the full Brief prompt only — Delta and Revision-narrative
     prompts are untouched.

3. **Validation** (`tools/categorizer/src/validate.ts`): `validateReadingOrder`
   — the field, when present, must be an exact permutation of the Brief's
   group ids (no missing, no extra, no duplicates). On violation: **warn and
   drop the field** (the Brief stays valid), mirroring `validatePartition`'s
   warn posture. Wire into the Brief pipeline in `categorize.ts`.

4. **Tests** (mirror existing patterns, mocked generator, no live calls):
   - Schema accepts a valid `readingOrder`, accepts its absence, rejects
     malformed steps.
   - Validation drops (with warning) on: missing group, extra id, duplicate
     id; keeps a valid permutation.
   - `categorize` output carries the field through untouched when valid.

### Stage 2 — FE: Story view order + Read-through

1. **Types/validation** (`apps/web/src/features/brief/types.ts`,
   `validation.ts`): mirror the optional `readingOrder` field; boundary-parse
   defensively (drop the field client-side too if it fails the permutation
   check against the parsed Brief — old artifacts and hand-edited demos).

2. **View model** (`viewModel.ts`): when a valid `readingOrder` exists, order
   `groups` by it and attach each group's step index + why-line to its
   `GroupView`; otherwise preserve today's source order. Within-group chunk
   order unchanged (carrier → supporting, Concern order).

3. **Story view** (`StoryView`/`GroupCard`): render the step caption on the
   group header — step position + why-line, visually subordinate (the caption
   explains order; it must not read as a rank badge). No sort toggle.

4. **Read-through** (`useKeyboardShortcuts.ts`, `BriefPage`):
   - `chunkIds` fed to the hook now follow reading-ordered groups × existing
     within-group order (one list change).
   - `Shift+J` / `Shift+K`: jump to first chunk of next/prev group in Reading
     order.
   - "Start read-through" affordance: enters focus mode at step 1; focused
     group shows why-line and "n of N". Esc exits as today. Update the `?`
     shortcuts hint.
   - Shortcuts still stand down while overlays/composers hold focus.

5. **Changes Only inheritance** (`ChangesOnlyView`): group sections adopt the
   full Brief's Reading order when present — ordering only, no captions
   needed there beyond what exists.

6. **Tests**:
   - View model orders groups by `readingOrder` and falls back to source
     order without it; step index/why-line attach to the right groups.
   - Client-side permutation guard drops a stale/invalid order.
   - `Shift+J`/`Shift+K` step groups; `J`/`K` behavior unchanged.
   - Characterization: Brief without `readingOrder` renders exactly as today
     (the degrade path is the compat story — no migration exists otherwise).
   - A11y: step captions are not color-only; focus order sane; hint updated.

### Verification (both stages)

- Categorizer: `pnpm typecheck` + `pnpm test` green.
- FE: typecheck + full suite (incl. characterization) green.
- Human gates: eyeball a live-generated `readingOrder` on a real multi-group
  PR (order quality + why-line tone) after Stage 1; browser pass on the
  Read-through after Stage 2.

## Risks / Watch-outs

- **Attention dilution** (ADR 0025 consequence): more instructions on the
  Brief call could degrade group quality. Watch during the Stage 1 eyeball;
  escape hatch is a second call later — the optional field doesn't preclude it.
- **Rank-badge drift.** The step caption must read as "why this order", never
  as a priority label. Copy review is part of the Stage 2 gate.
- **Stale orders.** Client-side permutation guard covers artifacts whose
  groups and order drifted (hand-edited demos, partial regeneration).
- **Key conflicts.** `Shift+J`/`Shift+K` must not collide with browser or
  existing app bindings; verify in the browser pass.

## Execution Tracking

Git workflow (locked via git-eng, 2026-07-02):

- Branch: **`feature/reading-order`** off `main`.
- Commit strategy: logical chunks (below), committed per stage. No
  Co-Authored-By trailers, no AI attribution.
- Pre-commit review agents: none — orchestrator reviews each stage's diff
  inline at the gates (lean-gate process), including plan-deviation audit
  with explicit keep/fix verdicts recorded here.
- End state: push + **ready PR to `main`** after Stage 2's gate and the
  manual browser pass.
- Implementation follows the `git-eng` commit/PR rules and invokes the
  `typescript-eng` skill before writing TypeScript.

Checklist:

- [ ] Stage 1: categorizer schema + prompt + validation + tests
- [ ] Gate: inline review; live generation eyeball (order quality, why-line
      tone, no dilution of group quality)
- [ ] Stage 2: FE story-view order + Read-through + tests
- [ ] Gate: inline review; browser pass (Read-through flow, Shift+J/K,
      degrade path, caption copy)
- [ ] Push + ready PR to main

## Session Bootstrap (context for a fresh session)

Everything a new session needs that isn't obvious from the repo:

**Where this came from.** Grilled 2026-07-02 (same session as the plan); all
decisions are captured in ADR 0025 and the table above — do not re-litigate
them. `CONTEXT.md` already has the **Reading order** / **Read-through**
entries with avoid-lists. Roadmap item: `docs/oss-roadmap.md` P2 (update its
status + progress log when this ships).

**Execution process (proven on the comparison-overlay feature, PR #14).**
Orchestrator dispatches one subagent per stage (Sonnet is sufficient for both
stages here — the plan is fully specified; Opus was only needed for judgment-
heavy refactor work). Stage prompts must carry: the branch + commit rules
above, "invoke `typescript-eng` before writing TS", the relevant plan stage
verbatim, and as-built amendments from the previous stage. Gate after each
stage = orchestrator reruns typecheck/tests, reads the diff inline focused on
that stage's risk spots (NO multi-agent review fan-out), audits flagged AND
unflagged deviations with keep/fix verdicts, records accepted deviations in
this plan, and sends fixes back to the same agent via its live context.

**Patterns to mirror (all on `main`, from the comparison-overlay work):**

- Warn-and-drop validation posture: `validatePartition` /
  `validateNarrativeGroups` in `tools/categorizer/src/validate.ts`.
- Categorizer test conventions: mocked `Generator` + mocked github module,
  fixtures parsed through the request's own schema —
  `tools/categorizer/test/revision-narrative.test.ts`.
- Prompt tone precedent: the Revision-narrative prompt's ~25-word summary
  budget and comprehension-language rules (`prompt.ts`,
  `buildRevisionNarrativeSystemPrompt`) — the why-line rules here are the
  same idea at ~15 words.
- FE boundary validation: `apps/web/src/features/brief/validation.ts`
  (Result-shaped parsers, fail-closed to null/drop).
- Characterization suite is the FE regression guard:
  `apps/web/src/characterization/` — must stay green; extend it for the
  degrade path.
- Keyboard nav: `apps/web/src/features/brief/useKeyboardShortcuts.ts` takes a
  caller-supplied `chunkIds` list — Read-through is a list change + one new
  key pair, not a new system. Query DOM by data attributes, never by CSS-module
  class names (hashing made `.railbtn-focus` a silent no-op once; fixed with
  `data-jump-target`).

**Known gotchas:**

- CLI SHAs get resolved to full via `resolveFullSha` (github.ts) — artifacts
  are keyed by full SHAs; FE joins are exact-equality.
- The Brief's group order today IS the LLM emission order — nothing else
  depends on it, which is why Story view can adopt the Reading order with no
  compat work beyond the absent-field degrade path.
- `pnpm typecheck` / `pnpm test` at repo root fan out to workspaces; the
  categorizer package has no lint script (typecheck + test only).

**User preferences that bind here** (also in memory): terse direct
communication; never rubber-stamp — re-derive and push back; recommendation +
open question over multiple-choice when designing; no emojis; no
Co-Authored-By/AI attribution anywhere; confirm before irreversible actions;
human gates (generation eyeball, browser pass) are the user's — never skip
or automate them.

## Suggested Commit Chunks

1. `feat(categorizer): add reading order schema and validation`
2. `feat(categorizer): emit reading order from the brief prompt`
3. `feat(web): order story view by reading order`
4. `feat(web): add read-through navigation`

## Out of Scope

- Reading order on Delta Briefs / `changedGroups` (ADR 0025: full Brief only).
- A user-facing sort toggle or any reordering control.
- Dependency computation / code-graph analysis.
- A second-call generation path (escape hatch only, if dilution shows).
