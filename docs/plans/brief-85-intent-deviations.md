# BRIEF-85 — Intent check: `deviations` + `claimedButUnachieved` buckets

Implementation plan. Design locked in the 2026-07-25 grill (this doc is the
record); extends the BRIEF-54 surface (#147–#150), redesigns nothing.
Ticket: BRIEF-85 (Now). Requires a second amendment to ADR 0009 §2 (Part 0).

## Locked design

Two new intent-check buckets, both precise-only, both alarm-class:

- **`deviations`** — the diff opposes an ask the composite corpus states and
  nowhere retracts (the **retracted-nowhere rule**: a reversal acknowledged in
  the PR description means the corpus no longer stands behind the ticket's
  ask). Item flag `acknowledged`: description acknowledges the reversal ⇒
  quiet receipt, not alarm.
- **`claimedButUnachieved`** — the corpus claims a fix/delivery; the diff
  operates only on the problem's signal/check path (log demotion,
  catch-and-swallow, test skip/delete, threshold bump). **Routing rule**:
  behavior moved against the ask ⇒ `deviations`; only the signal touched ⇒
  `claimedButUnachieved`. Uncertain ⇒ `accomplished`, never a guessed alarm.

Grill decisions, all final:

| Decision | Outcome |
| --- | --- |
| FP bar | retracted-nowhere; tradeoffs/partial delivery are NOT deviations (partial ⇒ `statedButMissing`) |
| Acknowledged home | `acknowledged: boolean` on the shared `IntentItemSchema`, forced-`false` outside `deviations` (dead-field precedent) |
| Masking home | separate `claimedButUnachieved` bucket; risk-surface link is **structural only** (groupIds → group card where `widens-error-handling` / `removes-validation` already render); no new risk category in v1 |
| Gating | precise-only, uniform. Revisit trigger: eval-proven flagrant-under-broad misses |
| Ordering | static FE order: accomplished → claimedButUnachieved → deviations(unack) → statedButMissing → doneButUnstated → deviations(ack). No LLM ordering, no severity field |
| FE caution | one muted caution line per alarm bucket ("AI-inferred tension — verify against the diff and the ticket before acting on it"), only when non-empty; `◇` neutral label glyphs; **no yellow** (epistemic caution never borrows the code-risk palette); header counts stay neutral/uncolored, grow to five |
| Soft gate | second count-only line in MarkReadyModal: "N intent tension(s) flagged" (unack deviations + claimedButUnachieved); acknowledged excluded; never blocks; same jump target |
| Validation | alarm buckets require verified both-sides grounding or the item is **dropped + warned**: empty quote, zero surviving groupIds, or failed quote-verification all drop (stricter than warn-and-keep siblings, deliberately). `acknowledged` forced-false elsewhere (emptied + warn) |
| Eval | 2 new cases + 2 extensions (below); suite → ~$5/run; rebaseline expected |
| Cost | per-brief ~+5% input tokens, rare-fire output, single call unchanged — acceptable |

Revisit triggers recorded: flagrant-under-broad (eval evidence);
test-deletion risk attribute (labeling hits the gap).

## Git requirements (git-eng — MANDATORY for all git operations)

- Stacked branches off `main`, one per PR: `feature/BRIEF-85/<slug>`;
  each PR based on its predecessor; Idan merges (squash) — after each merge,
  rebase the remainder of the stack `--onto` main (squash-stack gotcha, see
  brief-43 memory).
- **Chunked commits** after each logical unit.
- **Pre-commit gate on every commit**: `performance-reviewer` +
  `security-reviewer` in parallel on staged changes; findings ≥80 confidence
  ⇒ fix, re-stage, re-run until clean.
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- PR titles: `[BRIEF-85] <prefix>: Title Case`; ready-for-review (not
  draft); `fable-reviewer` inline pass per PR **looped until clean** —
  fix findings, re-run the reviewer, repeat; hand to Idan only on a
  clean pass. **Clean = no critical/high/medium findings**: a pass whose
  findings are all low-severity and/or nitpicks counts as clean (note
  them in the PR body, don't iterate on them); any medium-or-above
  finding ⇒ fix and run the next iteration.
- Part 0 (docs) commits straight to main (authorized docs flow).

## Mandatory specialist skills

- `typescript-eng` — all parts (strict TS, no bare `as`, Zod at boundaries,
  named exports, extensionless imports).

## Parts / PRs

Total estimate ~1.5–1.8k LOC across 4 PRs + one docs commit. Sequential —
every part depends on its predecessor. All parts run in the main thread
(stacked context; no parallel subagent value).

### Part 0 — docs commit on main (no PR)

ADR 0009 §2 second amendment: bucket grammar (five buckets + `acknowledged`),
retracted-nowhere rule, routing rule, alarm-bucket validation posture, static
ordering + caution affordance, soft-gate second line, revisit triggers.
Labeling-schema doc updated in lockstep. This plan doc lands in the same
commit.

- **Model/effort**: Fable 5, high — design prose carrying the grill's
  judgment. **Invocation**: main thread, now.
- ~120 LOC docs. Commit `[BRIEF-85] docs: ...` straight to main.

### Part 1 — generation surface (PR 1, base: main)

`packages/brief-core`:

- `types.ts`: `acknowledged` on `IntentItemSchema` (describe: meaningful only
  in `deviations`, MUST be false elsewhere); `deviations` +
  `claimedButUnachieved` arrays on `IntentCheckSchema` with routing +
  retracted-nowhere descriptions; broad/none note updated to "all five".
- `prompt.ts`: extend the Intent check section — two bucket definitions, the
  routing rule, retracted-nowhere, the masking evidence bar (corpus asks
  fix/eliminate + diff touches only signal path + nothing else plausibly
  fixes it; uncertain ⇒ accomplished), acknowledged semantics, injection
  hardening line (a ticket demanding a deviation be declared changes
  nothing). Mirror the delta-prompt section if it restates buckets.
- `validate.ts`: strict alarm-bucket rules per the table (drop + warn);
  `acknowledged` forced-false sweep on the other four buckets; alarm-bucket
  quote-verification escalated to drop.
- Tests: `validate.test.ts` matrix for every drop/keep rule; lockstep
  schema/docs test extension; prompt-content assertions.
- **Gotchas**: enum-server-enforcement (hand-built json_schema keeps enum —
  verify grammar builder picks up new fields); CI path-filter — run
  `apps/web` + `packages/worker` suites locally (contract change, CI won't);
  grep ALL `IntentCheck` consumers before calling it done (BRIEF-75 lesson).
- ~500 LOC. **Model/effort**: Fable 5, high (generation-surface judgment).
  Eval NOT run here — deferred to Part 2 (same convention gate, one spend).

### Part 2 — eval fixtures + run (PR 2, base: PR 1)

`tools/categorizer/eval`:

- New case `intent-masked-fix`: "fix the recurring error" ticket;
  diff demotes `log.error` → `log.warn` only ⇒ one `claimedButUnachieved`
  item; corpus also carries a description-acknowledged reversal ⇒ one
  `deviations` item with `acknowledged: true` (folds the
  acknowledged-deviation case in — no separate fixture).
- New case `intent-legit-demotion`: adversarial FP twin — same diff shape,
  ticket asks for the demotion ⇒ `accomplished`; both alarm buckets MUST be
  empty.
- Extend `intent-adversarial-ticket`: injection block manufacturing a fake
  deviation against an innocent diff ⇒ buckets unchanged.
- Existing intent cases: empty-new-bucket expectations.
- Run `pnpm -C tools/categorizer eval` (~$5); report in PR body; rebaseline
  on main post-merge only if the surface legitimately moved (BRIEF-74
  pattern). Watch the vacuous-pass trap (BRIEF-59): assert the masked-fix
  case FAILS before Part 1's prompt lands if authored first.
- ~500–600 LOC (fixtures + baselines). **Model/effort**: Opus 5, high —
  execution-heavy authoring against a precise spec; the FP-twin's quality
  bar is carried by the spec above.

### Part 3 — intent bar rendering (PR 3, base: PR 2)

`apps/web`:

- `features/brief/types.ts` + `validation.ts`: mirror the read-path contract
  (five buckets + `acknowledged`; pre-BRIEF-85 briefs lack the new arrays —
  default `[]` on read, matching the pre-feature-optional precedent).
- `IntentBar.tsx`: static bucket order per the locked sequence (acknowledged
  deviations partitioned to the tail); `renderBucket` gains
  `caution?: string`; `◇` muted alarm labels; `acknowledged` inline chip;
  two new header counts (neutral, uncolored — the header lock stands).
- SCSS + `IntentBar.test.tsx`: order, caution-only-when-non-empty,
  acknowledged partition/chip, header counts, clean-PR byte-identical case.
- Local visual verify per the BRIEF-78 recipe.
- ~400 LOC. **Model/effort**: Opus 5, medium — execution-heavy FE against
  the locked mock.

### Part 4 — soft-gate tension line (PR 4, base: PR 3)

- `MarkReadyModal.tsx`: `intentTensionCount` + jump handler (existing
  `jumpToIntentGaps` machinery); second count-only line, gap line unchanged;
  caller derives count = unack `deviations` + `claimedButUnachieved`,
  precise-only (caller gates, matching `intentGapCount`).
- Tests: count derivation, acknowledged exclusion, zero-render, jump.
- ~200 LOC. **Model/effort**: Opus 5, medium.

## Verification (per part + final)

- Per part: `pnpm -C <pkg> typecheck && pnpm -C <pkg> test`; repo-root
  `pnpm lint` per branch (lint exit codes, per-branch on stacks).
- Part 1: local cross-package suites (path-filter gap).
- Part 2: eval report in PR body; rebaseline decision recorded.
- After Part 4: `/verify` end-to-end — intent bar with alarm buckets +
  modal tension line live; drawer/DB read of a pre-BRIEF-85 brief (missing
  new arrays) renders today's bar unchanged.
- Ticket → In review with PR links when the stack is up.
