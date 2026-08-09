# BRIEF-156 — Comment/docs verbosity sweep

Ticket: https://app.notion.com/p/3b75e9400eeb81fca641fc4b7d26dc18
Memory: `feedback-comment-verbosity-no-ticket-refs` (rule + scope FINAL — do not
relitigate), `feedback-lean-comments` (earlier narrower version).
Convention: root `AGENTS.md` "Comments stay lean and reference-free" bullet.

## Goal

Bring the existing codebase in line with the standing convention: comments and
narrative docs state only non-obvious constraints, one short line, and never
cite ticket ids, ADR numbers, PR numbers, or review-round names. Repo is going
public; those references resolve to nothing for an outside reader.

## Scope (decided, do not relitigate)

**In:**
- Code comments (`//`, `/* */`) in `.ts`/`.tsx`/`.scss` across every package,
  app, and tool.
- Test descriptions (`it("... (BRIEF-134)")`) — describe the case, never the
  ticket.
- Narrative docs: `README.md` (all of them), `CONTEXT.md`, `PRODUCT.md`,
  `AGENTS.md` (root + all 11 package files), generic `docs/dev/**` files.
- **Obvious-comment removal is repo-wide (scope B, decided in grill):** any
  comment that restates what the code plainly shows gets deleted, whether or
  not it carries a reference. This is a full comment-quality pass over every
  file with comments (~613 ts/tsx files, ~17.4k comment lines), not just the
  657 ref-bearing files.

**Out:**
- `docs/adr/**` — references are the document's identity.
- `docs/plans/**` — same exemption (grill Q8): plan docs ship public with
  their ticket identity and citations intact. **Knock-on: PR 1 amends the
  root `AGENTS.md` convention bullet, which currently lists `docs/plans/**`
  in the ban.**
- Per-ticket `docs/dev/**` working docs (`brief-11-impl-notes.md`,
  `brief-40-testing.md`, …) — same character as plan docs; only the generic
  recipes/capability docs there get swept.
- `tools/categorizer/eval/cases/**` and `pair-cases/**` (grill Q1) — ticket
  ids there are scored specimen/expected content; editing them silently
  invalidates baselines. Eval *harness* code (`eval/*.ts`, `test/eval-*.ts`)
  is normal source and stays in scope.
- Drizzle migration files/journal tags — immutable history (comments inside
  SQL may be trimmed if touched, filenames/tags never).

## Trim bar (calibrated in grill Q5, moderate)

1. Strip the ticket/ADR/PR parenthetical or clause; keep the sentence when it
   states a real constraint.
2. Delete rationale sentences beyond the one constraint line — no essays,
   no "why we chose X", no provenance blocks.
3. If nothing non-obvious survives the strip, delete the whole comment — no
   orphaned half-sentences.
4. Delete comments that restate obvious code, reference or not.
5. Moderate, not maximal: keep a short line where the constraint genuinely
   isn't visible from the code.

Calibration examples (locked):

```
// BEFORE
// Health surface (BRIEF-51, ADR 0034 #7): answered BEFORE the Hono
// router mounts, so /healthz stays reachable even if router init throws.
// AFTER
// Health surface answered before router mounts, so /healthz stays
// reachable even if router init throws.
```

```
// BEFORE
it("renders the intent bar directly beneath the summary (BRIEF-134)", ...)
// AFTER
it("renders the intent bar directly beneath the summary", ...)
```

## Survey (2026-08-09)

- 657 files carry `BRIEF-`/`ADR`/`PR #` references outside `docs/adr/**`
  (~3.8k raw hits); 21 of them are excluded eval fixture/expected files.
- Files with comments (scope B universe): ~613 ts/tsx + ~657 scss comment
  lines in apps/web + ~90 markdown docs.
- Comment-line volume: `packages/*` ≈ 10.1k, `apps/web` ≈ 7.2k,
  `tools` ≈ 0.4k.
- apps/web is the largest single area (290 src files + e2e).

## Hazards

- **Eval gate (generation surface):** brief-core PR touches
  `generation/prompt.ts` etc. — comment-only edits must leave prompt string
  bytes identical; the committed prompt snapshots prove it. State in the PR
  body: snapshots unchanged ⇒ no eval run. Any snapshot delta = out of scope,
  back it out.
- **String literals are not comments:** never edit prompt text, log `msg`
  copy, user-facing strings, or fixture content in this sweep — except test
  *descriptions* citing tickets (explicitly in scope, grill Q3).
- **`v8 ignore` comments** carry stated reasons by convention — trim wording
  if verbose, never delete the reason.
- **Lint-disable comments** (`eslint-disable` + reason) — same: reason stays.

## PR breakdown (6 independent PRs off `main`, grill Q7)

File sets are disjoint — no stacking, any merge order. LOC ceiling ~1,000 per
PR is a hard gate (comment-only earns no exemption): measure
`git diff --stat main` after every chunk-commit; if a PR will blow the
ceiling, stop and split further before pushing.

1. **Docs** — root `AGENTS.md` (incl. convention-bullet amendment for the
   `docs/plans/**` exemption) + 11 package `AGENTS.md` + `README.md`s +
   `CONTEXT.md` + `PRODUCT.md` + generic `docs/dev/**`.
2. **apps/web part 1** — `src/components` + `src/routes` (+ their scss).
3. **apps/web part 2** — `src/characterization`, `e2e`, remaining `src/**`,
   `src/styles`.
4. **persistence + api** — src + test.
5. **brief-core + github + generators + worker** — src + test.
6. **cli + logging + repo-config + types + tools/categorizer harness** —
   src + test.

Branch naming: `chore/brief-156-<part>`; PR titles
`[BRIEF-156] chore: <Title Case>`.

## Skills mandatory for implementation

- **git-eng** — invoked explicitly for ALL git operations (branching, commits,
  push, PR creation via `gh`); no raw git outside it.
- **typescript-eng** — conventions hold even in comment-only edits (never
  strand an `eslint-disable` marker, never touch code while "fixing" a
  comment).

## Git workflow (git-eng requirements)

- Branch per PR off `main`: `chore/brief-156-<part>`; independent, no stack.
- Commits: chunked, one logical commit per subagent area / package /
  doc-group.
- Pre-commit gate: **security-reviewer** on the staged diff before every
  commit; findings ≥80 confidence get fixed and re-reviewed before commit.
- LOC gate: `git diff --stat main` after every chunk-commit against the PR's
  budget below; blown budget ⇒ stop and split, never push over.
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- PR titles `[BRIEF-156] chore: <Title Case>`; push `git push -u origin HEAD`,
  then `gh pr create`; ask draft vs ready per PR.

## Per-PR estimates and invocation

| PR | Est. diff | Model / effort | Invocation |
|---|---|---|---|
| 1 Docs | ~300–500 LOC (mostly deletions) | main thread (session model) | sequential — sets the calibration bar |
| 2 apps/web components+routes | ~600–900 LOC | Opus 5, medium | 3–4 parallel subagents on disjoint subdirs |
| 3 apps/web char+e2e+styles+rest | ~500–800 LOC | Opus 5, medium | 2–3 parallel subagents |
| 4 persistence+api | ~600–900 LOC (densest constraint comments — highest judgment load) | Opus 5, medium-high | single agent sequential |
| 5 brief-core+github+generators+worker | ~500–800 LOC | Opus 5, medium | one subagent per package, parallel (disjoint) |
| 6 cli+logging+repo-config+types+tools | ~200–400 LOC | Opus 5, low-medium | single agent sequential |

Estimates assume roughly a quarter to a third of comment lines get trimmed or
deleted; they are budgets, not just guesses — the LOC gate enforces them.

## Verification per PR

- Run each touched package's test suite locally before pushing
  (path-filtered CI won't run dependents).
- apps/web PRs also run `pnpm -C apps/web lint` — comment deletion can strand
  `eslint-disable-next-line` markers.
- PR 4/5: brief-core prompt snapshots must be byte-identical (proves no eval
  run needed); state it in the PR body.

## Steps

1. PR 1 (docs) — main thread, sets the pattern; Idan reviews to confirm the
   trim bar before anything else runs.
2. PRs 2–6 after PR 1's bar is confirmed — any order, budgets enforced per
   chunk-commit, security-reviewer per commit, draft-vs-ready asked per push.
