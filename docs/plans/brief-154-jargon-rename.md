# BRIEF-154 — Rename jargon terms to plain words

Ticket: https://app.notion.com/p/3b65e9400eeb81cdbe93c65a735a5d2e
Memory: `brief-154-jargon-rename-2026-08` (rename + keep lists are FINAL — do not relitigate)

## Goal

Repo is going public (BRIEF-38). Replace insider jargon with plain words in code,
comments, docs, and product copy so an outside reader doesn't need a dictionary.

## Rename list (decided, do not relitigate)

| Term | Replacement | ~Occurrences | Notes |
|---|---|---|---|
| prose | text | ~272 | product-rule copy, prompts, `--prose-cap` CSS token, `capped-prose` test id, `validateProseLength`, `ProseSurfaces` |
| provenance | origin | ~382 | includes PUBLIC port method `generator.provenance()` |
| corpus | source(s) | ~166 | "intent corpus" → "intent sources" |
| gloss / glosses | description(s) | ~72 | `CATEGORY_GLOSS`, `CONCERN_GLOSS`, `RISK_GLOSS` consts + docs |
| load-bearing | critical | ~70 | comments/docs |
| seam | boundary / interface | ~333 | pick per sentence, mostly docs/comments |
| boot probe | startup check | ~27 | worker/harness docs + log copy |
| composition root | startup wiring | ~54 | `main.ts` docs/comments |
| orthogonal | independent | ~9 | docs |

**Keep list (do not touch):** disposition, posture, taxonomy, affordance, lede,
specimen, ordinal, "closed vocabulary", harness, anchor/anchored, verdict,
salvage, canary, sidecar, idempotent, invariant, hoist, discriminated, stitch,
frozen/re-look, curated, eyebrow, first-class, carrier/supporting.

## Survey findings (this session, confirms ticket)

- **`prose` collides with a legitimate unrelated usage**: Tailwind/CSS typography
  class names and `.prose`-style utility classes may appear in `apps/web` scss/tsx
  — verify each hit is the jargon meaning ("AI-authored prose") before renaming,
  not a CSS convention name.
- **Persisted schema check (done)**: grepped `packages/persistence/src/schema/*.ts`
  — all `provenance`/`seam`/`load-bearing` hits there are **comments only**, no
  column is literally named `provenance`. No migration needed for schema.
- **Wire-contract check (done)**: no API/response field is named `provenance`
  either — the persisted/served columns are `provider`/`model`/`effort`
  (`packages/persistence/src/schema/brief.ts:26-28`); every `provenance` hit in
  `packages/api/src/routes/reads.ts`, `apps/web/**/types.ts`, and the web
  components is a comment or doc-string. The `generator.provenance()` rename in
  PR 3 is therefore a pure in-code rename — no wire or migration coordination
  needed.
- **Third-party config keys are off-limits**: `.prettierrc.json` has
  `"proseWrap": "preserve"` — that's prettier's own option name, never rename
  it (a comment in `.prettierignore` references it too; reword the comment's
  own words if desired but keep the literal option name intact). Watch for the
  same pattern anywhere a renamed word is an external tool's API.
- **Eval fixtures/expectations are specimen data, not our vocabulary**:
  `tools/categorizer/eval/cases/**/fixture.json`, `pair-cases/**/pair.json`,
  and `expected.ts` files contain the terms as captured diff content or
  baseline expectations. Renaming words inside them silently invalidates
  baselines. Rule: leave fixture/pair specimen content untouched; touch
  `expected.ts` only where it imports a renamed identifier, and any change to
  expectation *text* requires the corresponding scoped eval run.
- **Migration file/tag `0016_brief-anchor-provenance`**: this is drizzle's
  immutable history — do NOT rename the file or journal tag. Comments inside the
  SQL file can be reworded; the filename/tag stays as historical record.
- **Identifiers confirmed in scope**: `RISK_GLOSS`, `CATEGORY_GLOSS`,
  `CONCERN_GLOSS` (packages/brief-core), `validateProseLength`, `ProseSurfaces`,
  `--prose-cap`, `capped-prose` test id (apps/web `ExpandableContent`,
  `SummarySection`, brief-core `categorize.ts`/`prompt.ts`/`validate.ts`/`types.ts`/`index.ts`,
  worker `anchoring.ts`).
- **`generator.provenance()`** is a public port method: touches
  `packages/generators` port + contract + every adapter (openai, anthropic,
  claudeCode, codex, openrouter), `packages/worker`, CLIs, eval harness fixtures
  referencing `provenance` case-ids (e.g. `schema-change-provenance` eval case dir
  — rename the *field usage* inside, but check whether renaming the eval case
  **directory name** breaks baseline/rebaseline lookups before doing it; if risky,
  leave the case id alone and only rename in-code identifiers).

## Renaming principle: contextual, not literal find-replace

The rename table gives the base word swap, not the literal new name. Every
site picks the plain word **and reshapes it to fit where it lives** —
component name, surrounding naming convention, local meaning. Do not do a
blind string substitution.

Example: `--prose-cap` lives on the `ExpandableContent` component, so it
becomes something like `--expandable-content-text-cap` (or whatever matches
that component's existing token-naming convention), not `--text-cap` in
isolation. Same logic applies everywhere:
- `capped-prose` test id → reshape to the component/behavior it's testing,
  not a literal `capped-text`.
- `RISK_GLOSS`/`CATEGORY_GLOSS`/`CONCERN_GLOSS` → check whether
  `RISK_DESCRIPTION`/etc. actually reads better in context, or whether the
  surrounding code's naming pattern (e.g. a `*_LABEL` sibling const) suggests
  a different plain word entirely.
- `seam`→boundary/interface: already called out as per-sentence in the ticket
  — same discipline extends to identifiers and CSS/test tokens, not just
  prose.
- `composition root`→startup wiring, `boot probe`→startup check: check the
  file/function's existing vocabulary (e.g. `main.ts`'s other comments) before
  picking the exact phrasing.

Apply this in every PR (1–4): read the surrounding code/doc section first,
then pick the name that fits it, rather than substituting the base word and
moving on.

## Skills mandatory for implementation

- **git-eng** for all git operations (branching, commits, PRs) — invoke explicitly,
  do not run raw git commands outside it.
- **typescript-eng** for all TS identifier/type renames.

## Git workflow (confirmed with user)

- Branch per part off `main`, stacked in the order below.
- Commits: **chunked**, logical commits within each PR (not one giant commit).
- Pre-commit review gate: **security-reviewer** on staged diff before every commit.
- PR title format: `[BRIEF-154] <prefix>: <Title Case Description>`.
- Push + PR after each part; ask user draft vs ready, confirm base branch per
  the stack (each PR bases on the previous, matching `watch-pr-stack` conventions
  if the stack needs babysitting through merges).

## Part / PR breakdown

### PR 1 — Docs + comments sweep
**Scope:** every rename term inside `docs/**`, `AGENTS.md`, `CLAUDE.md`,
`README.md`, `**/*.md`, and inline code comments (not identifiers, not string
literals, not prompt text). Mechanical find-and-verify pass — biggest share of
occurrences (~majority of the ~1400 total hits), but each is a search-and-reword,
no runtime risk.
**Excludes:** `CONTEXT.md` / `PRODUCT.md` / README "no AI-authored prose" product
rule — that's PR 4 territory (writing pass, not find-replace), skip those specific
sentences here even though the files get touched for other doc comments.
**Est. LOC:** large by line-count-touched but trivial per-line — expect 800–1200
LOC diff; consider splitting `docs/adr/**` (historical, reword conservatively —
ADRs are decision records, keep tone) from `docs/plans/**`/`docs/dev/**` if the
diff estimate exceeds ~1000 LOC once counted.
**Model/effort:** Fable 5 or Sonnet at low-medium effort — mechanical, no design
judgment beyond picking seam→boundary vs seam→interface per sentence.
**Invocation:** single agent (or main thread), sequential file-by-file; no
parallelism needed, low risk of conflicting edits.

### PR 2 — Identifier renames (non-prompt, non-port)
**Scope:** `RISK_GLOSS`/`CATEGORY_GLOSS`/`CONCERN_GLOSS` consts,
`validateProseLength`, `ProseSurfaces`, `--prose-cap` CSS custom property,
`capped-prose` test id, and any other renamed-term identifiers in
`packages/brief-core`, `apps/web`, `packages/worker` **excluding**
`generator.provenance()` (PR 3) and prompt.ts prose/corpus/gloss **string
literals** sent to the model (PR 4 — eval-gated). Update all call sites and
tests referencing these identifiers.
**Verify:** no renamed identifier is a stored/serialized field name (confirmed
clean in survey above, but re-check touched files before commit).
**Eval-gate note:** this PR touches `prompt.ts` and `validate.ts`, which the
repo rule (CLAUDE.md / BRIEF-87) gates on eval runs. The escape hatch: an
identifier-only rename must leave prompt bytes **byte-identical** — the
committed prompt snapshots (`prompt-snapshots.test.ts.snap`) prove it. State
in the PR body: snapshots unchanged ⇒ no eval run needed. If any snapshot
changes in this PR, that change is out of scope here — it belongs in PR 4;
back it out. Validator **warning-message copy** (user-facing strings
mentioning "prose") may be renamed here since warnings never feed the model —
say so in the PR body alongside the snapshot proof.
**Est. LOC:** ~200–400 LOC (identifiers + call sites + test updates across
~12 files found in survey).
**Model/effort:** Sonnet, medium effort — needs typescript-eng discipline
(no bare `as`, extensionless imports) and care not to touch prompt.ts string
content in this pass, only identifiers/types.
**Invocation:** single agent, sequential.

### PR 3 — `generator.provenance()` port rename
**Scope:** rename the public port method `generator.provenance()` →
`generator.origin()` (confirm exact name with user before committing — ticket
suggests `origin()` but doesn't lock it) across:
- `packages/generators` — port interface, contract test (`contract.ts`), every
  adapter (`openai`, `openaiCore`, `anthropic`, `claudeCode`, `codex`,
  `openrouter`), `harness/probe.ts`, `harness/run.ts`, `config/registry.ts`
- `packages/worker/src/task/generate.ts` and its test
- `packages/repo-config/src/provenance.ts` (consider renaming file too —
  `origin.ts` — if typescript-eng conventions favor filename matching export)
- `packages/brief-core` generation code + tests referencing `.provenance(`
- `packages/persistence` store/schema **comments** referencing provenance (no
  column rename needed, confirmed above)
- CLIs and eval harness code paths that call the port method directly
- `apps/web` `ProviderBadge`, `Header`, `BriefDetailsPanel`, `ChangesOnlyView`
  — comments/doc-strings only (wire-contract check above confirmed no
  `provenance`-named field crosses the API); pure local rename
- `packages/generators/smoke/generate-smoke.ts` and test shims
  (`test/shims/fake-codex.cjs`, `fake-claude.cjs`) — port-method call sites
  live here too
**Isolated PR reason:** ticket explicitly calls for this as its own PR — public
API surface, high blast radius, needs its own review pass.
**Est. LOC:** 300–600 LOC across generators + worker + api + web.
**Model/effort:** Sonnet, high effort — this is the one part needing real design
judgment (port contract change, cross-package coordination, verifying the
wire-field question above before touching persisted/API shapes).
**Invocation:** single agent, sequential (not parallelizable — one rename
touching one contract across many call sites; parallel edits would conflict).

### PR 4 — Prompt-text renames + product-copy writing pass
**Scope:**
- `packages/brief-core/src/generation/prompt.ts` string literals: prose→text,
  corpus→source(s) ("intent corpus" → "intent sources"), gloss wording.
- Update `packages/brief-core/test/generation/__snapshots__/prompt-snapshots.test.ts.snap`
  to match.
- `CONTEXT.md` / `PRODUCT.md` / `README.md` "no AI-authored prose" product rule
  — reword as a writing pass (not mechanical find-replace), get the sentence
  right, not just the word swap.
- Any remaining prompt-adjacent copy (validators/salvage messages surfaced to
  users) using these terms.
**Eval gate (BRIEF-87):** this touches the generation surface — run
`pnpm -C tools/categorizer eval --case <id>` scoped to cases whose properties
could plausibly move (prose-length/corpus/gloss-related cases — check
`tools/categorizer/eval/cases/` and `pair-cases/` for anything referencing
these terms, e.g. `schema-change-provenance` case if its expected output
mentions provenance wording). Report the eval output in the PR body. Full
suite only if scoped runs show unexpected drift. `--rebaseline` on main only
if the surface legitimately moved (wording changed = it did move — expect to
rebaseline the affected snapshot cases, confirm with user before running
`--rebaseline`).
**Est. LOC:** small code diff (~50–100 LOC) but the eval report is the real
deliverable here.
**Model/effort:** Sonnet, high effort for the prompt wording itself (getting
plain phrasing right without changing model behavior) — this is the most
subtle part of the whole stack, low tolerance for accidental meaning drift.
**Invocation:** single agent, sequential, last in the stack (depends on nothing
from PR 1–3 but ordered last per ticket's stated hazard ordering).

## Sequencing note

PR 1 and PR 2 touch disjoint file sets from PR 3/PR 4 in the common case, but
all four are proposed as a **stack** (PR2 based on PR1, etc.) rather than
independent branches, since the same files (e.g. `packages/brief-core/src/generation/prompt.ts`,
`categorize.ts`, `types.ts`) get touched by both the comment sweep (PR1) and
identifier/prompt renames (PR2/PR4) — stacking avoids merge conflicts and
matches the user's usual stacked-PR flow ([[feedback-pr-review-subagent-flow]]).
If PR 1 turns out fully disjoint from PR 2–4 in practice, they can be
retargeted to `main` independently — call this out to the user once PR 1's
diff is known.

## Steps

1. **PR 1** — git-eng: branch `chore/brief-154-docs-sweep` off `main`. Sweep
   docs/comments per scope above, chunked commits (e.g. per rename term or per
   top-level dir), security-reviewer gate before each commit. Push, PR to `main`.
2. **PR 2** — git-eng: branch `refactor/brief-154-identifiers` off PR 1's branch.
   Rename identifiers, update call sites + tests. Run affected package test
   suites locally (path-filtered CI note — brief-core/apps/web/worker). Chunked
   commits, security-reviewer gate. Push, PR based on PR 1's branch.
3. **PR 3** — git-eng: branch `refactor/brief-154-provenance-port` off PR 2's
   branch (or off `main` if PR 1/2 merged by then — confirm with user at start
   of this part). Confirm `origin()` naming with user first. Rename port method,
   all adapters, worker, persistence comments (wire-field question already
   settled: none exists, see survey). Run generators + worker +
   api + apps/web test suites locally. Chunked commits, security-reviewer gate.
   Push, PR.
4. **PR 4** — git-eng: branch `refactor/brief-154-prompt-copy` off the current
   head of the stack. Rename prompt.ts strings, update snapshot, writing pass
   on CONTEXT.md/PRODUCT.md/README. Run scoped eval (`--case <id>` per affected
   case), include report in PR body, `--rebaseline` only after confirming with
   user. Chunked commits, security-reviewer gate. Push, PR.
5. After each PR is pushed, ask user: draft or ready for review, confirm base
   branch actually merged/rebased if earlier PRs landed first (stack hygiene —
   see `watch-pr-stack` skill if the user wants the rebase-through-merges
   automated).
