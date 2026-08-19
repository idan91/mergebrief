# BRIEF-197 — Review Session implementation plan

Spec: `brief-197-review-session-spec.md`. Decision record:
`docs/adr/0040-review-session-server-store.md`.

19 PRs in five subtasks, stacked in dependency order. Two mechanical renames
go first so every later PR writes the final names. Nothing in this plan
touches the generation surface (`prompt.ts`, the output schema, validators or
salvage), so **no eval spend anywhere** — the worker changes are
coordinate-persistence next to the model call, never inside it.

**Shape confirmed 2026-08-17: one continuous stack.** All 19 PRs run as a
single effort, executed without stopping at subtask seams. The split triggers
at the foot of this document are the only sanctioned deviation; a stack this
long rebasing under 19 squash-merges is the known risk, and `rebase --onto`
with patch-id proof is the standing answer to it.

## Mandates

- **git-eng governs every git operation** — invoke it explicitly, never
  hand-roll the commands. Requirements gathered 2026-08-17:
  - Stacked PRs off `main`, one branch per PR, each based on its predecessor;
    squash-merge, then `rebase --onto` realignment of the rest of the stack
    with patch-id proof. HTTPS + the `gh` credential helper.
  - **Chunked commits** — commit after each logical unit inside a PR, not one
    squashed commit at the end.
  - **No `Co-Authored-By` trailers and no AI-attribution anywhere** in commit
    messages or PR bodies.
  - PR titles `[BRIEF-197] prefix: Change Description In Title Case`; no PR
    template exists in this repo, so bodies use Overview / Changelog /
    Images & Videos, with screenshots on every web PR.
  - **Idan merges.** The agent pushes, opens the PR, and reports; it never
    merges and never force-pushes a branch under review without saying so.
- **Reviewer gates per PR:** the branch-diff reviewer on every PR;
  security-reviewer additionally on PRs 2–5, 9, 13, 14; performance-reviewer
  additionally on PRs 8, 10, 16–19. Findings ≥80 confidence: fix, re-stage,
  re-run until clean. **Runtime substitution:** the Fable quota is spent, so
  reviewer agents and the Fable-5-recommended PRs below run on **Opus 5 at
  high effort**; the recommendations keep naming Fable 5 because that is the
  right capability match when quota returns.
- **Specialist skills (mandatory, confirmed 2026-08-17):**
  - `typescript-eng` — every PR.
  - `ponytail` — every PR. The laziest thing that works: reuse what exists
    before adding, no speculative abstraction, no scaffolding for later. This
    stack invents 12 operations and 7 tables; the discipline is what keeps it
    from inventing 20 and 11.
  - `tdd` — PRs 6 and 8 (the carry-over core). Both are pure logic whose
    failure mode is silent and dangerous: a wrongly-placed anchor reads as
    correct. Test first, red before green.
  - `web-accessibility` — PRs 16–19.
  - `impeccable` — PRs 18 and 19, on rendered UI, screenshots measured before
    shipping.
- **Verification per PR:** owning package `typecheck` + `test` + repo-root
  `pnpm lint`; `apps/web build` on any isomorphic/server-only web change;
  `pnpm -C packages/api manifest:check` on any descriptor change;
  `pnpm -C packages/i18n test` on any wire-error or copy change (CI's path
  filter will not run it for an api-only edit).
- **LOC ceilings are hard.** Budgets below are review-load commitments. Run
  `git diff --stat <base>` after every part-commit; when a PR is heading past
  its budget, split it and say so before pushing.
- **Migrations are append-only** and `drizzle-kit generate` only — never
  `push`. The checked-in `drizzle/meta/*` snapshots are history: a rename is a
  new migration, never an edit to an old snapshot.

---

## Subtask 1 — Renames (no behaviour change)

### PR 1 `refactor(web): MindMap* → ReviewSession*` (~400 LOC, ~35 files)
Rename the client store, its provider, hooks, types and test names; rename the
i18n keys that carry the old term and their catalog entries; update
`apps/web/AGENTS.md`. No file moves beyond what the rename forces. Pure
rename — a reviewer should be able to read the diff as a substitution.
Model: Opus 5, medium effort.

### PR 2 `refactor(persistence): reviewer_session → auth_session` (~350 LOC, ~20 files)
New migration `ALTER TABLE reviewer_session RENAME TO auth_session` plus the
schema file, resolver, stores, purge routine, api tests and `AGENTS.md` map.
Existing `drizzle/meta` snapshots stay untouched. This clears the collision
with the product term before any new table uses it.
Model: Opus 5, medium. Security-reviewer (auth path).

---

## Subtask 2 — Schema and stores

### PR 3 `feat(persistence): review_session + the four owned tables` (~700 LOC)
Migration + drizzle schema for `review_session`, `review_draft_comment`,
`review_read_mark`, `review_group_reclassification`,
`review_submitted_review`; branded ids; the `review_outcome` CHECK vocabulary
in lockstep (`as const` map + migration); ctx-bound store methods on
`forTenant` (upsert-on-key create, per-subject upserts, session read); PGlite
tests including the tenancy containment cases.
No `submit_note` column, no `granted_scope` column — both are deliberate
(spec §2.1). Model: Fable 5, high effort (schema shape). Security-reviewer.

### PR 4 `feat(persistence): disposition amendment, hunk_span, carried chunk ids, token scope` (~600 LOC)
`disposition` gains `review_session_id`, `carry_status`, `evidence_status` and
loses `decided_at_sha` / `pull_request_id` / `reviewer_id` (zero readers and
zero writers today, so this is a migration against an empty surface, not a
data migration); new `hunk_span` table; `brief.carried_chunk_ids`;
`api_token.scope` with its CHECK migration and backfill to `external-write`.
Model: Fable 5, high. Security-reviewer (token column).

### PR 5 `feat(persistence): audit_log columns, open-key metadata, retention` (~650 LOC)
Add `operation`, `classification`, `channel`, `credential_id`, `outcome`,
`request_id`, `client`, nullable `caller_ip`; drop `action` and its CHECK;
invert the metadata allowlist to open keys / closed values (token, number,
boolean) with tests for the value rules; `AUDIT_RETENTION_DAYS` (30-day floor)
and `AUDIT_PRIVATE_WRITES` and `AUDIT_CALLER_IP` in `db/config.ts`;
retention sweep routine (wired to a schedule in PR 15); **rewrite
`packages/persistence/AGENTS.md`'s audit invariant** — three of its four
clauses no longer hold.
Model: Fable 5, high. Security-reviewer.

---

## Subtask 3 — Carry-over core

### PR 6 `feat(brief-core): remapThroughHops` (~350 LOC)
Pure composition of a hop chain over `remapRanges`, range granularity, one
call per anchor, all-or-nothing demotion preserved; an empty or missing hop in
the chain demotes everything. Table-driven tests including force-push and
retarget shapes. No I/O. **`tdd` — tests first**: a wrongly-placed anchor
reads as correct, so red-before-green is the only honest gate here.
Model: Fable 5, high (the correctness core).

### PR 7 `feat(worker): persist hunk spans and the carried chunk set` (~400 LOC)
`planAnchoredGeneration` writes the `hunk_span` row from the
`parseHunkSpans` result it already computes, **before** the model call, like
`comparison_marks`; `stitchBrief`'s carried chunk ids reach
`artifact-store`'s brief write instead of being discarded. Coordinates only —
no line content, so no `persist_baseline_snapshot` gate.
Does not touch prompt, schema, validators or adapter defaults: **no eval
spend**. Model: Opus 5, high.

### PR 8 `feat(persistence): carry-over evaluation and materialization` (~700 LOC)
Read-side evaluation (in memory, creates nothing) and the
materialize-on-first-write transaction: create the session row, copy carried
rows with their verdict columns, apply the write. Read marks carry only
against `carried_chunk_ids`; reclassifications only where the group id
descended; the review outcome never carries; any untrustworthy span orphans
every anchor. Freeze semantics: a session freezes when a newer one is
materialized. **`tdd` — tests first**, covering the multi-push chain (7 → 8 → 9 → 10 is one
evaluation) and the concurrent-first-write race before the transaction is
written.
Model: Fable 5, high. Performance-reviewer (the transaction is on the write
path).

---

## Subtask 4 — API surface

### PR 9 `feat(api): credential scope, router gate, agentAvailable deleted` (~700 LOC)
Scope vocabulary and mint-time selection; the scope check inside
`productRouter.action()`/`.query()` off the declaration's classification;
`scope-exceeded` (403) through the full wire-error recipe (api code + status +
English, `errors.scope-exceeded` in i18n, the `apps/web` mirror); delete
`agentAvailable` from the descriptor, both declaration interfaces, all 23
declarations and the manifest; CLI-map `entrySchema` gains `webOnly` and
absence becomes an error for every id; `list-tokens` / `list-installations` →
`webOnly`, `mint-token` / `revoke-token` / `select-installation` → `webOnly`;
update `packages/api/AGENTS.md`, `packages/cli/AGENTS.md` and
`docs/plans/brief-196-product-operation-catalog.md`.
Model: Fable 5, high. Security-reviewer.

### PR 10 `feat(api): read-review-session + attention list` (~600 LOC)
The session read route (pure — never creates a session), the attention-list
projection folded into its payload, and the second derivation in
`apps/web`'s shared module reused server-side where the shape is shared.
`clearedBy` is a non-empty list of operation ids. Model: Opus 5, high.
Performance-reviewer.

### PR 11 `feat(api): draft comments, replies, read marks, reclassification` (~700 LOC)
`create-draft-comment`, `update-draft-comment`, `reanchor-draft-comment`,
`delete-draft-comment`, `save-draft-reply`, `set-chunk-read` (one operation
carrying a boolean), `reclassify-group`. Every write names its Brief
explicitly; every write can be the one that materialises carry-over.
Model: Opus 5, high.

### PR 12 `feat(api): dispositions and review outcome` (~500 LOC)
`dismiss-risk`, `address-risk`, `reopen-risk` (three operations, three
payloads — a reason, per-flag evidence, a bare undo; all take an id array),
`set-review-outcome`. The human-only guard for the clearing operations lands
here as **one predicate in the handler layer**. Model: Opus 5, high.

### PR 13 `feat(api): submit publishes server-held drafts` (~600 LOC)
`submit-review` wire becomes `{briefId, outcome, body}`; the handler publishes
the drafts the server holds, flips their status and records the review id; the
100-comment cap moves from the request to the session; `create-inline-comment`
and `reply-to-comment` name a server-held draft; new
`draft-already-published` (409) through the full wire-error recipe.
Model: Fable 5, high. Security-reviewer (external write path).

### PR 14 `feat(api): audit emit at the router choke point` (~500 LOC)
One emit in `productRouter.action()` covering every action plus denials, keyed
on the descriptor id; delete the nine hand-placed emits and the `AuditAction`
vocabulary; `api.access` gains `operation`; CLI sends
`user-agent: mergebrief/<version>` (~5 lines) under the rule that **nothing
may ever branch on it**; `caller_ip` populated only under the PII flag, socket
address only, with the reverse-proxy caveat documented in
`docs/self-host/operations.md`.
Model: Fable 5, high. Security-reviewer.

### PR 15 `feat(worker): first scheduled job — audit retention sweep` (~350 LOC)
Wire graphile's scheduled-job support (unused today; the worker has no cron),
run the sweep instance-wide rather than ctx-bound, honour the 30-day floor and
the unset-means-forever default; document the erasure query
(`delete … where actor_id`) in `docs/self-host/operations.md` — a documented
query, not a feature. Model: Opus 5, high.

---

## Subtask 5 — Web app

### PR 16 `feat(web): session read in the route loader` (~700 LOC)
The loader reads the session in parallel with the Brief artifact; the store
hydrates from loader data instead of the effect at `provider.tsx:94`; the
`sessionStorage` persistence effect and its snapshot are **deleted** (existing
browser sessions are dropped, not migrated); the loader degrades rather than
fails, and writes are off when the session read errored. File-backed briefs
render read-only. Model: Fable 5, high. Performance-reviewer.

### PR 17 `feat(web): per-action writes and failure recovery` (~700 LOC)
Every store action fires one operation; no batching, no network debounce, no
retry machinery. On failure the UI returns to the state where the action is
still available — the checkbox un-ticks, the composer stays open holding its
text, which makes the composer **close on write success rather than on
click**. Refetch on window focus picks up a CLI write. A 409 from a frozen
session is terminal for the screen: read-only behind the existing revision
banner. Model: Fable 5, high. Performance-reviewer.

### PR 18 `feat(web): carry-over row and attention list` (~600 LOC)
The four row states (no row on a first-ever session; clean-carry receipt;
the list in its place; back to the receipt when the last item clears), no
dismiss button, the span always stated with a revision count when more than
one push happened. Three item kinds reusing the existing `UnresolvedItem`
shape and jump-to-item mechanic. All copy through `packages/i18n` (the
`brief.prototypeCarryover.*` strings at `491846aa` are the starting draft,
not the final keys). Model: Fable 5, high. impeccable + web-accessibility.

### PR 19 `feat(web): delete Clear local drafts, ship reopen-risk` (~450 LOC)
Delete the button and its `clearSnapshots()` + `actions.reset(...)` path;
give `disposeFlag(ids, {kind:"open"})` its first UI caller as the narrow undo
for a mis-dismissed risk; delete `postComment.ts`'s per-tab in-flight
registry, settled queue and drain-on-mount, replaced by one in-flight request
per draft (a disabled button, not a protocol).
Model: Fable 5, high. impeccable + web-accessibility.

---

## Execution

**Sequential.** Every PR depends on its predecessor's schema, types or routes,
so there is nothing to parallelise: PR 3 needs PR 2's rename, PR 8 needs PR
6's function and PR 4's columns, the web PRs need the routes.

**The driving session is an orchestrator, not an implementer.** 19 PRs of
file reads, test loops and diffs would fill a 1M context around PR 12, and
compaction is precisely where this stack's silent-failure invariants stop
being verbatim. So:

- The driving session holds the plan, the invariants and the stack status. It
  does not read source files, run the test loop, or hold diffs.
- **Each PR is implemented by a fresh subagent** which reads the spec section
  it needs, writes the code, runs the gates, and reports back in **≤20 lines**:
  what it changed, `git diff --stat` totals, gate results, and anything it
  could not do. Its tool output never enters the driving context.
- **Reviewer gates stay subagents**, as they already are.
- **Three PRs get a design brief from the driving session first** — PR 3
  (schema shape, which everything downstream keys off), PR 6 and PR 8 (the
  carry-over core, whose failure mode is silent: a wrongly-placed anchor reads
  as correct). The subagent implements to that brief rather than re-deriving
  the design from the spec.

**Model per PR** is named at each entry. The rule behind the choices: schema
shape, the carry-over core, the scope gate, the submit rewire and every web
behaviour change get high-capability, high-effort runs; renames, route
migration against an established template and mechanical route work do not.
Per the runtime substitution above, Fable-5 entries execute on Opus 5 at high
effort until quota returns.

**No merging during the run.** Each branch bases on its predecessor; all 19
push and open PRs against their predecessor branch, so every diff stays
reviewable on its own. Idan reviews the whole stack at the end. The
`rebase --onto` realignment mechanics (and `watch-pr-stack`) start only once
he begins merging — nothing in this run rebases a pushed branch.

**No mid-stack checkpoints.** Execution continues PR to PR until blocked or
until a split trigger fires; a subtask boundary is not a reason to stop and
ask. Blocked means a decision the spec does not answer, a gate that cannot go
green, or a split trigger firing — not "this PR was interesting".

## Ticket housekeeping carried by this stack

- **The seven CLI-map gaps ticketed BRIEF-197 are re-ticketed to BRIEF-201**
  (expiry 2026-12-31) in PR 9, together with the 12 new gap entries. BRIEF-197
  closes without shipping CLI commands, so a gap pointing at it would point at
  a closed ticket.
- **`generate-brief` and `list-collaborators`** stay BRIEF-201 gaps — the two
  of the original four that are real gaps rather than corrections.
- **BRIEF-98** owns ingesting file-backed brief artifacts into DB rows. This
  stack does not block on it; local review-flow testing runs on directly
  seeded DB briefs.

## Split triggers

- PR 3 or PR 8 past 800 LOC → split the store methods from the schema
  (PR 3) or the read-side evaluation from the materialization transaction
  (PR 8).
- PR 9 past 800 LOC → land the `agentAvailable` deletion and the CLI-map
  inversion as their own PR ahead of the scope gate; they are mechanical and
  independently reviewable.
- PR 17 past 800 LOC → split the composer's close-on-success change out; it
  is the one behaviour change in an otherwise mechanical PR.
