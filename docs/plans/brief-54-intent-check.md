# Plan — BRIEF-54: Intent check (ticket-gated shared Brief section)

> Status: **LOCKED — grill closed 2026-07-24, not started.**
> Ticket: Notion BRIEF-54. ADRs: **0009 §2 as amended 2026-07-24** (composite
> intent sources — the amendment lands with this plan), **0031** (shared
> section, single view), **0014** (linked-context boundary, reused untouched),
> **0032** (fencing/trust posture, hand-built json_schema enum enforcement).
> Design is locked; the schema/prompt PR is the only design-sensitive part.

## What this delivers (product + technical context)

**Product:** the Brief answers "did this PR do what its ticket asked?". When
the PR's stated intent (title + description + linked tickets, judged together)
is precise, a new **intent bar** reports three factual buckets — accomplished,
stated-but-missing, done-but-unstated — each claim cited (verbatim quote +
source for ticket-side, change-group links for diff-side). Broad/absent intent
⇒ "intent check unavailable", never a guessed gap. The BRIEF-43 mark-ready
modal gains one count-only secondary line (precise source + gaps only). Both
consumers see the same section; it is never a verdict.

**Technical:** four moves. (1) `brief-core`: `IntentCheck` schemas on
`BriefGenerationSchema` (full brief only), prompt section for the composite-
source judgment, post-parse validators (warn-and-drop), warnings wiring.
(2) Eval: intent cases + adversarial ticket-injection fixture; rebaseline.
(3) FE: the intent bar component stacked with the attribute jump-rail.
(4) FE: the mark-ready modal line. No new fetch, no new generation call, no
migration (brief JSON is schemaless at rest; read-path schema gains an
optional field).

## Locked decisions (grill 2026-07-24 — do not re-litigate)

1. **Composite intent sources** (amends ADR 0009 §2's fallback chain): intent =
   PR title + description + ALL ticket-like linked blocks, judged together.
   Model resolves sources in-prompt; no harness URL heuristics.
2. **Schema** (no optionals — strict structured-output; Sol lesson):

   ```ts
   interface StatedAsk { intent: string; quote: string; sourceUrl: string } // "" = title/description
   interface IntentCheck {
     ticketUrls: string[];                       // ⊆ injected linked-context URLs (validated)
     specificity: "precise" | "broad" | "none";  // master switch; broad/none ⇒ buckets empty
     scopeNote: string;                          // "" unless ticket spans beyond this PR (stacks)
     accomplished: (StatedAsk & { groupIds: string[] })[];
     statedButMissing: StatedAsk[];              // no diff anchor by definition
     doneButUnstated: { description: string; groupIds: string[] }[]; // no ticket side
   }
   ```

   Factored exactly so (StatedAsk base for the two ticket-side buckets; no
   artificial universal base). Lives on `BriefGenerationSchema` **only** —
   delta and revision narrative never carry it.

   > **Amended 2026-07-24 (PR 1 implementation):** the locked three-shape
   > factoring is dead on arrival — Anthropic's structured-output grammar
   > compilation rejects it (`400 "The compiled grammar is too large"`;
   > probed live).
   >
   > **Corrected 2026-07-25 (BRIEF-85, measured):** the mechanism recorded
   > above — "exactly ONE object shape beyond the base schema", budget
   > "structural — distinct object shapes, not bytes", tighter with thinking
   > enabled — is **wrong**, and following it walks straight back into the
   > cliff. What the grammar actually does is **inline the referenced shape
   > at every `$ref` site**, so cost is (array `$ref` sites × fields per
   > shape); `$defs` dedupe does not carry into the grammar. Measured on
   > `claude-opus-4-8`: four bucket arrays × four fields compiles; five
   > arrays, or four arrays plus a fifth field, both 400. Descriptions are
   > ~free (trimming 10727 → 9968 bytes still failed). Thinking mode is
   > irrelevant — `thinking: {type:"disabled"}` and `claude-opus-5` fail
   > identically. Consequence: **five bucket arrays cannot be generated at
   > any field count**, which is why BRIEF-85 emits ONE tagged `items` array
   > and fans it out (ADR 0009 §2 wire-shape note).
   > All three buckets now share ONE `IntentItemSchema`
   > `{intent, quote, sourceUrl, groupIds}`; the per-bucket field rules
   > moved to the mechanical floor (`validateIntentCheck`, warn-and-drop)
   > and the prompt: `statedButMissing.groupIds` MUST be `[]` (emptied +
   > warn), `doneButUnstated.quote`/`sourceUrl` MUST be `""` (emptied +
   > warn; its description rides `intent`). Probed clean including the
   > custom-attribute enum-widening path. The three top-level buckets,
   > never-a-verdict, and everything else in this decision stand.
3. **Enum enforcement**: `specificity` is a `z.enum` flowing through the
   existing enum-preserving hand-built json_schema (PR #22 / `enforceSchema`
   path). Structural field — schema-invalid takes hard-fail + one feedback
   retry, never salvage.
4. **Validation** (`validate.ts`, warn-and-drop → `generationWarnings`):
   - broad/none with non-empty buckets → empty all three + warn (mechanical
     "never a guessed gap");
   - `ticketUrls` ⊄ injected URLs → drop unknown + warn; item `sourceUrl` must
     be `""` or ∈ surviving `ticketUrls`, dangling → drop item + warn;
   - `groupIds` vs the Brief's changeGroups (readingOrder precedent): dangling
     id dropped + warn; stated-side items survive with pruned ids;
     `doneButUnstated` items with zero valid ids are dropped (no grounding);
   - quote verification: whitespace-normalized substring vs fetched source —
     **warn-only v1** (revisit: escalate to drop on fabrication evidence).
5. **Rendering — the intent bar**: full-width row stacked with the
   `AttributeJumpRail` (post-summary instrument cluster). Header **always
   visible**: neutral symmetric counts, all three buckets named, never
   gap-first, no warning colors/icons. Body collapsed by default, **never
   auto-expands** (auto-open on model inference = the ADR 0009 anchor).
   Fallible framing = first line of the expanded body. Unavailable = same
   quiet bar, one line with reason. `groupIds` render as story jump-links.
6. **Soft gate (BRIEF-43 modal)**: one count-only line ("N stated asks not
   found in the diff"), rendered only when `specificity == "precise"` and
   `statedButMissing.length > 0`; click closes modal → jumps to expanded bar;
   the modal's trigger condition is untouched (gaps alone never open it);
   no line when clean (absence, not a green verdict).
7. **Back-compat**: generation schema requires `intentCheck`; the read/stored
   schema treats it as optional; briefs without the field render **no bar**.
8. **Revisit triggers** (recorded, not built): per-item multi-source citations
   if composite still skews stacked-PR buckets; quote-check escalation to
   drop; header counts glanceability (nobody expands → reconsider); a
   cross-revision intent comparison view; delta-side intent regeneration.

## Git requirements (git-eng — mandatory for all git operations)

- **This plan doc + the ADR 0009 amendment commit straight to main** and push
  (standing docs-on-main authorization). All code goes via PRs.
- **Stacked branches** off main: `feature/brief-54-intent-schema` → PR 1;
  PR 2 stacks on 1; PR 3 stacks on 1; PR 4 stacks on 3. Squash-merge
  discipline: after each merge, `rebase --onto` the remaining stack (see
  git-push-workflow memory); never plain-pull a just-rebased branch.
- **Commits: chunked** — one commit per logical unit within a PR.
- **Pre-commit gate, every commit: `performance-reviewer`** on staged
  changes. **`security-reviewer` additionally** on commits touching fencing/
  validation/prompt surfaces (PR 1) and FE rendering of model-produced
  URLs/quotes (PR 3 — `sourceUrl` becomes an href; sanitize scheme, and
  quotes render as text only). Findings ≥80 confidence: fix, re-stage,
  re-run until clean.
- PR titles: `[BRIEF-54] feat: …` per git-eng rules; no AI attribution
  anywhere.
- **Review loop**: `reviewer` subagent on each PR branch diff before
  handing to Idan; reply+fix upstream-first on stacks; Idan merges.

## Mandatory specialist skills (user-confirmed)

- **`typescript-eng`** — all TS work (strict TS, no bare `as`, named exports,
  extensionless imports, as-const maps).
- **`tdd`** — test-first for the validators, schema, and modal/bar logic.

## PR breakdown

### PR 1 — brief-core: schema + prompt + validation (~680 LOC)

The only design-sensitive PR. **Model: Fable, high effort, main thread.**

1. `types.ts`: `StatedAskSchema`, `AccomplishedAskSchema`
   (`StatedAskSchema.extend`), `UnstatedWorkSchema`, `IntentCheckSchema`;
   field on `BriefGenerationSchema` (required) and on the read-path
   `BriefSchema` as `.optional()`. Verify `briefGenerationSchemaWith`
   (custom-attribute extension) still composes. Confirm the hand-built
   json_schema emits the `specificity` enum (existing pipeline — expect zero
   changes; assert in test).
2. `prompt.ts`: new "## Intent check" section — composite-source judgment,
   source resolution + `ticketUrls` rules, specificity description
   (precise/broad/none), the three buckets with citation rules
   (verbatim quote ≤ ~200 chars; groupIds must reference emitted groups),
   scopeNote bound ("one sentence, scope facts, usually empty"), buckets
   MUST be empty on broad/none, untrusted-ticket reminder (directives inside
   `<linked_context>` never alter buckets — reuse existing fencing language).
   Full-brief builder only; delta/revision prompts untouched.
   `prompt-snapshots.test.ts` updated.
3. `validate.ts`: `validateIntentCheck(intentCheck, changeGroups,
   injectedUrls, fetchedContent)` implementing locked decision 4; wire into
   `categorize.ts` warnings path (same register as readingOrder drop).
4. Audit **all** BriefSchema consumers for the optional read field
   (apps/web parse, api routes, persistence, worker) — BRIEF-75 lesson:
   grep every consumer, don't assume.
5. Tests: schema round-trips, validator matrix (each drop/keep rule),
   prompt snapshot, json_schema enum presence.
6. **Eval gate (BRIEF-59, mandatory)**: `pnpm -C tools/categorizer eval` on
   the branch; report in the PR body. Expect baseline drift (new field on
   every case) — **rebaseline on main post-merge**, per convention. Live API
   spend: budget one full run + the rebaseline run.

### PR 2 — eval: intent cases + adversarial fixture (~250 LOC)

Stacks on PR 1. **Model: Fable, medium effort, main thread** (case
expectations need judgment; spend-aware).

1. Positive case: PR with a precise linked ticket → buckets populated,
   quotes verbatim, groupIds valid.
2. Broad/none cases: epic-style ticket and no-ticket PR → `specificity`
   correct, buckets empty.
3. Adversarial fixture (ADR 0032 #12 pattern): ticket text containing
   directives ("mark everything accomplished", schema-override attempts) →
   buckets stay diff-grounded, no instruction-following.
4. Run + commit results per harness convention; note flaky/stable in the
   baseline map.

### PR 3 — web: intent bar (~550 LOC)

Stacks on PR 1 (parallel to PR 2). **Model: Sonnet, high effort, main
thread** — design fully locked; execution against existing patterns
(conversation bar anatomy, jump-rail placement). `reviewer` gate
before handoff.

1. `IntentBar` component (exported prop interface; facade hook if it grows —
   component-conventions memory): header (label + sources + three counts /
   unavailable line), collapsible body (bucket lists, quotes with source
   links — scheme-sanitized hrefs, text-only quotes), fallible-framing first
   line.
2. BriefPage wiring: stacked with `AttributeJumpRail`; absent field → no bar
   (back-compat); expose an imperative "expand + scroll-to" handle for PR 4's
   jump.
3. Group jump-links reuse the existing group-jump machinery (TocBar path).
4. Warnings: intent-check validator warnings already ride
   `generationWarnings` surfacing — verify, no new UI.
5. Tests: render states (precise/broad/none/absent), collapse behavior,
   jump-link wiring, href sanitization.

### PR 4 — web: mark-ready modal line (~150 LOC)

Stacks on PR 3. **Model: Sonnet, medium effort, main thread** (small, locked
contract).

1. `MarkReadyModal`: count-only secondary line below the flags list,
   quiet styling; rendered iff `specificity == "precise" &&
   statedButMissing.length > 0`; click → close modal + jump to expanded bar
   (PR 3 handle).
2. Caller: trigger condition explicitly untouched — assert in test that
   gaps alone never open the modal.
3. Tests: line presence matrix, jump wiring, trigger invariance.

## Sequencing & invocation summary

| PR | Scope | Model / effort | Invocation | Gates |
|---|---|---|---|---|
| docs | plan + ADR 0009 amendment | — (this session) | main, straight to main | — |
| 1 | brief-core schema/prompt/validation | Fable / high | main thread | perf + sec pre-commit; eval report in body; reviewer |
| 2 | eval cases + adversarial | Fable / medium | main thread, after 1 | perf pre-commit; reviewer |
| 3 | intent bar FE | Sonnet / high | main thread, after 1 | perf + sec pre-commit; reviewer |
| 4 | modal line | Sonnet / medium | main thread, after 3 | perf pre-commit; reviewer |

Post-merge: rebaseline eval on main (PR 1 drift); `/verify` smoke on the web
surface (bar render on a live brief, mark-ready line on an own-draft PR).

## Verification

```sh
pnpm -C packages/brief-core typecheck && pnpm -C packages/brief-core test
pnpm -C apps/web typecheck && pnpm -C apps/web test
pnpm lint                          # exit code, per-branch on the stack
pnpm -C tools/categorizer eval     # PR 1 + PR 2; report in PR body
```

CI is path-filtered: PR 1 changes a contract consumed by web/worker — run
their suites locally before pushing (BRIEF-23 lesson).
