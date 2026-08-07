# BRIEF-143 — Cross-revision stability: implementation plan (6-PR stack)

Source of truth: `docs/plans/brief-143-stability-spec.md` @ db2fe83e (normative
design; do not relitigate decisions there). Research:
`brief-143-mechanical-path-research.md`. Board ticket carries the handoff
checklist this plan expands.

## Git workflow (git-eng — MANDATORY for all git operations)

- Stacked branches, one per PR: `feature/brief-143-pr1-config-stamp` →
  `feature/brief-143-pr2-mechanical-core` → `feature/brief-143-pr3-worker-stitch`
  → `feature/brief-143-pr4-prompt-contract` → `feature/brief-143-pr5-eval-pairs`
  → `feature/brief-143-pr6-fe-restart-line`. Each branch based on its
  predecessor; PR base = predecessor's branch, retargeted to `main` as the
  stack merges.
- Squash-merge stack discipline: after each merge, realign descendants with
  `rebase --onto` (patch-id proof); never plain-pull a rebased branch.
  `/watch-pr-stack` may babysit the merge train.
- **Chunked commits**: commit after each logical unit inside a PR.
- **No `Co-Authored-By` trailers; no AI-attribution in PR descriptions.**
- PR titles: `[BRIEF-143] feat: <Title Case>`; body per repo template rules;
  eval-report section where the gate trips (PR 4, PR 5).
- **Pre-commit gate**: `security-reviewer` + `performance-reviewer` run in
  parallel on staged changes before every commit; findings ≥80 confidence get
  fixed and re-run until clean.
- **Pre-PR gate**: `fable-reviewer` on the branch diff before each PR goes up;
  medium+ findings iterate, nitpick-only = clean.
- CI is path-filtered per package: contract-touching PRs (2, 3, 4) must run
  dependents' suites locally before push (`pnpm -r test` or targeted).

## Mandatory skills

- `typescript-eng` — all code (strict TS, no enums, Result for expected
  failures, named exports, extensionless imports).
- `test-driven-development` — all parts; non-negotiable for PR 2 and PR 3
  (pure functions guarding mechanical invariants).
- Repo conventions: coverage floors ride `pnpm test` (ADR 0038); logging via
  `packages/logging` seam, levels per ADR 0034.

## Model & invocation

**Fable 5, all parts** (owner's call, 2026-08-07 — supersedes the 2026-08-05
Opus-only ruling for this stack). Effort: high for PRs 2–4, medium for PRs 1,
5, 6. Invocation: **sequential in the main thread** — every PR depends on its
predecessor; no parallel subagent implementation. Review agents
(fable-reviewer / security-reviewer / performance-reviewer) are the only
subagents.

## The stack

### PR 1 — config + provenance plumbing (~300–400 LOC, effort: medium)

No behavior change. Ships the vocabulary the rest of the stack consumes.

1. `full-regeneration: always | on-model-swap | never` (default `never`) in
   `packages/generators/src/config/registry.ts`, validated per-provider like
   effort; threaded through `GenerateTaskDeps` (as-const map + `ValueOf`, no
   enum).
2. `anchor` provenance: `anchored | fresh-restart(reason) | none` — field on
   the brief artifact contract (`packages/generators/src/contract/provenance.ts`
   neighborhood) + columns/JSON on brief rows
   (`packages/persistence/src/stores/artifact-store.ts`, schema + migration).
   Stamp `none` for first generations, `anchored` hardcoded-off (writer wired,
   value forced until PR 3 flips it on).
3. Tests: config validation matrix, stamp round-trip through the store.

### PR 2 — mechanical core in brief-core (~600–900 LOC incl. tests, effort: high)

Pure functions beside `packages/brief-core/src/diff/` — TDD, no worker wiring.

1. **Touched-ness predicate**: previous-brief chunk ranges × incremental-diff
   removed/added ranges → per-group frozen|re-look verdict. Conservative:
   rename/binary/mode/unconfirmed ⇒ touched (fetch compare `files[].status` +
   `previous_filename` — currently unfetched; extend the compare fetch shape).
2. **Line-offset remapper**: hunk-header offsets → new ranges for frozen
   chunks; ambiguity (hunk overlapping a frozen range edge) returns a
   demotion verdict, never a guess.
3. **Id-descent matcher**: generated groups × previous groups by file
   overlap; merge → dominant parent's id; split → dominant child keeps;
   unmatched → mint. Deterministic, order-stable.
4. Tests are the deliverable: property-style unit suites per function,
   including the demotion and conservative-fallback paths.

### PR 3 — worker stitch (~500–800 LOC, effort: high)

`packages/worker/src/task/generate.ts` integration; flips anchoring on.

1. Hoist the prevHead→head span-diff fetch to before generation; load the
   previous brief body via the existing retry-resume read path.
2. Freeze/withhold: partition groups via PR 2 predicate; withhold frozen
   groups from the generation call's expected output.
3. Stitch: merge frozen (remapped) + generated regions; rewrite ids via
   descent; stamp per-group carried-vs-regenerated (internal); stamp brief
   `anchor: anchored`.
4. Validation: salvage on raw model output as today → stitch → **full
   validators on the merged artifact** + new coverage check (every PR file in
   exactly one group). Coverage failure = pipeline error, not salvage.
5. `full-regeneration` policy switch: `always` bypasses everything (today's
   path, byte-compatible); `on-model-swap` compares stamped provider/model on
   the previous brief row → fresh restart, stamped with reason.
6. Tests: worker-level fixtures for freeze/stitch/demotion/coverage; the
   `always` path asserted byte-identical to pre-stack behavior.

### PR 4 — prompt contract (~400–600 LOC, effort: high) — TRIPS EVAL GATE

`packages/brief-core/src/generation/` (prompt.ts, categorize.ts).

1. Anchor-view renderer (model on ADR 0024's `renderBriefContext`): frozen
   index (id/title/description/files/attrs — no code), re-look full previous
   definitions, summary+changelog verbatim, intent verdicts + current ask,
   ordering id sequences. ~1–2k tokens typical.
2. Prompt framing: three-tier trust (diff/ask ground truth > previous brief
   trusted reference with light data-not-instructions guard > linked context
   untrusted/ADR 0032 unchanged); re-look rules (keep what holds, change what
   the diff warrants, merge/split among re-looked only, claim-into-frozen via
   index); minimal-edit summary; intent transition honesty; ordering
   insert/drop.
3. Schema: model output restricted to re-looked + new groups (frozen ids
   forbidden in output except as claim targets).
4. **Eval gate**: scoped `--case` runs per affected fixture property,
   justify selection in the PR body, report included. Full suite only if
   prompt-wide drift is suspected.

### PR 5 — eval fixtures + property pairs (~700–1000 LOC, effort: medium)

`tools/categorizer/eval` — new revision-pair fixture shape.

1. Fixture machinery: pair = base fixture + constructed increment; one
   synthetic pair per change-impact category (additive, meaning-changing,
   risk-add, risk-remove, subtractive, new-material, boundary-restructure,
   ask-edit, rebase-noise, intent-transition) + 1–2 real multi-revision pairs
   from this repo's history.
2. The six stability↔completeness property pairs from the spec. Mechanical
   rows (untouched-survival, frozen-attrs, coverage) hard-assert; model-judged
   rows join the stable-pass/flaky discipline (BRIEF-74 map).
3. Spend recording per pair; baselines committed; `full-regeneration: always`
   asserted baseline-compatible.
4. Beware the vacuous-pass trap (BRIEF-59): every property must be shown to
   FAIL against a deliberately broken run before its baseline lands.

### PR 6 — FE fresh-restart line (~150–250 LOC, effort: medium) — /impeccable

1. Muted one-liner in the revision context (timeline/narrative area) when the
   revision's brief is stamped `fresh-restart`: "Regenerated fresh — model
   change." No header badge. Hidden entirely on `always` instances and
   anchored revisions.
2. Thread the `anchor` stamp into the revision-narrative prompt context so
   the narrative names the discontinuity (brief-core narrative input touch —
   if this trips the eval gate for the narrative surface, scope one `--case`).
3. `/impeccable` audit on the rendered UI (both themes) before the PR goes up;
   axe pass per web-accessibility conventions.

## Out of stack (recorded, not implemented here)

- Rebase patch-equivalence detection (REST patch-hashing) — severable
  follow-up; until it lands rebases take the conservative full re-look path.
- `pull_request.edited` subscription — separate board ticket (filed, Later).
- README stability-contract docs — written at stack completion, straight to
  main (docs-only).

## Sequencing & gates summary

PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6, strictly sequential (stacked).
Gates: security+performance reviewers pre-commit (all PRs); fable-reviewer
pre-PR (all PRs); eval gate at PR 4 (and PR 6 narrative touch if applicable);
/impeccable at PR 6; local dependent-suite runs before push on PRs 2–4;
`always`-path byte-compat asserted at PR 3 and re-asserted by PR 5 baselines.
