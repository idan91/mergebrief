# BRIEF-148 — Prose length caps + enforcement: implementation plan

Status: PLAN. Decisions locked in the 2026-08-08 grill (session "BRIEF-148");
this document is the execution contract. Ticket: BRIEF-148. Sibling context:
BRIEF-143 anchored regeneration (`brief-143-stability-spec.md`), BRIEF-104
lede caps.

## Locked design (do not re-litigate)

1. **No schema `maxLength`** — grammar-budget risk, decode hard-fail blast
   radius, cross-model strictness roulette. The output schema does not change.
2. **Prompt is the primary enforcement.** Caps land in the full-brief prompt
   (group title + summary), the delta prompt (`changedGroups`), the revision-
   narrative prompt (overview + chunk summary), and the riskNotes rule —
   in the BRIEF-104 "hard caps, never targets" register, plus a
   split-don't-inflate rule: a summary needing more than two sentences means
   the group probably holds two intents — split it. PR lede/changelog caps
   (BRIEF-104) stay exactly as they are.
3. **Validator is warn-only.** Mechanical char ceilings in
   `packages/brief-core/src/generation/validate.ts`, warnings joining the
   existing `generationWarnings` stream. No trim, no retry, no hard fail.
   Trim is a future escalation gated on evidence (post-hardening eval still
   showing walls of text on real models).
4. **Caps** (prompt states the ideal in sentences/words; validator warns at
   the max in chars — generous so a warning means a real violation):

   | Surface | Prompt ideal | Validator max (chars) |
   | --- | --- | --- |
   | Group title (full + delta) | <100 chars, one line | 150 |
   | Group summary (full + delta `changedGroups`) | 1-2 short sentences, ~200 chars, aim for one | 250 |
   | Narrative chunk summary | one sentence, <100 chars | 150 |
   | Narrative overview | 1-2 short sentences (down from 1-3) | 250 |
   | riskNotes note | one short factual note | 200 |
   | PR lede + changelog | unchanged (BRIEF-104) | none |

5. **`lengthViolations` stamp**: structured artifact field
   (`{surface, field, actual, cap}` entries), pipeline-added after
   validation — never model-emitted, never in the generation schema. FE
   renders one muted line in the revision context when non-empty
   ("summaries exceed length guidance — consider a stronger model"
   register; precedent: BRIEF-143 fresh-restart line). The narrative hover
   callout additionally gets a display-side CSS line-clamp — presentation
   guard, never data mutation.
6. **Anchored minimal-edit drift: prompt-only.** Promote the minimal-edit
   rule to its own hard-rule block inside `ANCHORED_SECTION`
   ("COPY the previous summary, then edit only what the diff forces;
   changed wording without changed facts is wrong output"). No similarity
   heuristic — code cannot split a legitimate update from a style rewrite
   on re-looked groups. Frozen groups cannot drift by construction.
   Documented model-quality caveat in `docs/self-host/generators.md`.
7. **Eval scoped ONLY** — no full-suite run (explicit owner decision).

## Git requirements (git-eng — mandatory for ALL git operations)

- Feature branches off `main`, stacked: PR2 branches off PR1's branch, PR3
  off PR2's. Squash-merge realignment per `git-push-workflow` memory
  (`rebase --onto`, never plain-pull a rebased branch).
- Chunked commits per logical unit. **Pre-commit gate: `security-reviewer`
  on staged changes before every commit**; findings ≥80 confidence get fixed
  and re-reviewed before committing.
- **`fable-reviewer` on each branch diff** before the PR goes up; iterate on
  medium+ findings (nitpick-only = clean, per review-loop severity memory).
- No Co-Authored-By trailers; no AI-attribution in PR bodies.
- PR titles: `[BRIEF-148] <prefix>: Title Case`. Idan merges.
- This plan doc commits straight to main (docs-only, authorized).

## Specialist skills (mandatory)

- `typescript-eng` — strict TS, no `enum`/`any`/bare `as`, named exports,
  extensionless imports, Zod at boundaries. Tests ride with code per package
  convention (no strict TDD ceremony).

## Part / PR breakdown (3 stacked PRs, sequential)

### PR 1 — core: prompt caps + validator warns + stamp (~500 LOC)

Branch: `feature/BRIEF-148/length-caps-core`. Model: Opus 5, main thread
(Fable quota constraint; wording register is pre-locked so execution-grade).

Chunks (one commit each, security-reviewer gated):

1. **Prompt caps** — `packages/brief-core/src/generation/prompt.ts`:
   - Shared cap prose as BRIEF-67-style consts where full + delta share
     phrasing verbatim (group title/summary caps); narrative caps inline.
   - Full prompt: cap language on `changeGroups` title + summary bullets;
     split-don't-inflate line in "Change-group boundary".
   - Delta prompt: same cap language on `changedGroups`.
   - Narrative prompt: overview 1-2 sentences; chunk summary one sentence
     <100 chars (keep the ~25-words framing consistent with the new
     numbers); riskNotes rule gains "at most ~200 chars".
   - `ANCHORED_SECTION`: minimal-edit promoted to a hard-rule block.
   - Update `prompt-snapshots.test.ts` pins + any prompt tests.
2. **Validator** — `validate.ts`: `validateProseLength(...)` warn-only
   check over group titles/summaries, narrative overview/chunk summaries,
   riskNotes notes; returns issues + structured violations. Caps as named
   consts (tuning constants, one place). Unit tests per surface incl.
   boundary values.
3. **Wiring + stamp** — `categorize.ts` (and worker stitch seam if the
   merged artifact is the right check point for anchored runs — verify
   against BRIEF-143 stitch: validators run on the MERGED artifact):
   violations → `generationWarnings` + new `lengthViolations` artifact
   field (stored shape only — generation schema untouched; precedent:
   generation shape ≠ stored shape). Persistence/type updates + tests.

Gate: `pnpm -C packages/brief-core typecheck && pnpm -C packages/brief-core test`,
root `pnpm lint`. Run worker/api suites locally if their types consume the
artifact shape (CI path-filter gap, BRIEF-23).

### PR 2 — eval: length metric + scoped runs + rebaseline (~200 LOC)

Branch: stacked on PR 1. Model: Opus 5, main thread.

1. Eval report gains per-surface char-count/violation metric (report-side
   code in `tools/categorizer/eval` — printed number, not eyeballing).
2. Scoped runs (BRIEF-87, one `--case` per run):
   - Cases whose summary-length properties could plausibly move
     (pick from the case list; justify selection in PR body).
   - BRIEF-143 stability pair cases — must not regress.
   - ONE cross-model spot run with muse-spark via `--config` on the worst
     offender (narrative + a group-summary case).
   - NO full suite (owner decision — budget).
3. Rebaseline on main post-merge where the surface legitimately moved.
   Eval report in the PR body.

### PR 3 — FE muted line + callout clamp + docs (~200 LOC)

Branch: stacked on PR 2. Model: Opus 5, main thread.

1. `apps/web`: muted revision-context line when `lengthViolations`
   non-empty (copy in the "consider a stronger model" register; reuse the
   fresh-restart line's slot/styling). CSS line-clamp on the narrative
   hover callout.
2. `docs/self-host/generators.md`: length-discipline + anchoring-stability
   degrade on weaker models; the muted line and what to do about it.
3. Visual check per render-before-shipping-CSS memory (compile, screenshot,
   measure) for the clamp + line.

## Verification (whole stack)

- Per-package: `pnpm -C packages/brief-core typecheck && test`; same for
  worker/apps-web where touched; root `pnpm lint`.
- Eval: scoped `--case` runs + muse-spark spot run; reports in PR 2 body.
- Live smoke (optional, `verify` skill): regen on a components PR revision,
  confirm warnings land and the muted line renders.
