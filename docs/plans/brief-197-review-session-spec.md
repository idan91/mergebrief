# BRIEF-197 — Review Session (spec)

The reviewer's unfinished work moves from the browser to our own server, keyed
by the Brief it was done against, and survives new commits. This document is
the whole model: what is stored, what happens when the PR moves, what the
reviewer is asked to look at again, what a credential may do, how the web app
writes, how a comment is stopped from posting twice, what the audit trail
records, and the full operation surface.

It consolidates the nine closed decisions of the BRIEF-197 wayfinder map and
reads standalone — nothing here requires the map. Decision record:
`docs/adr/0040-review-session-server-store.md`. Companion build plan:
`brief-197-review-session-implementation.md`.

Terms are `CONTEXT.md`'s (Brief, Chunk, Change group, Flag, Disposition,
Checkpoint, Receipt, Session baseline), with one change recorded in §1.

---

## 1. The model

### 1.1 What a Review Session is

A **Review Session** is one reviewer's private work on one PR, pinned to one
**Session baseline**. It holds draft comments, draft replies, per-Chunk read
marks, Change-group reclassifications, Flag Dispositions, the chosen review
outcome, and the ids of reviews already submitted from it.

The server store is the source of truth for that work. GitHub is the publish
target at Submit and never the drafting backend, because GitHub cannot hold
most of it: REST cannot add a comment to an existing pending review (no
`pull_request_review_id` parameter exists — GraphQL only), a provisional
outcome cannot be stored on a pending review at all, GitHub nowhere documents
what happens to pending review comments after a push, and it has no home for a
Disposition, a per-Chunk read mark, or a reclassified Change group. (Verified
against GitHub's OpenAPI description and published GraphQL schema, 2026-08-16.)

### 1.2 Naming

**"Mind-Map Space" is retired.** Review Session is the single term for this
workspace. `CONTEXT.md`'s **Session baseline** entry changes from a transient
label to the durable key of a Review Session. **Checkpoint** is unchanged — it
is still the last submitted review, and it is not the same span as a Review
Session's carry-over span (§3.1). The code rename (`MindMap*` →
`ReviewSession*`) and the `reviewer_session` → `auth_session` rename that
clears the resulting name collision ride the build plan, not this document.

### 1.3 Keying

`UNIQUE (installation_id, brief_id, reviewer_id)`.

The Brief drives the reviewer's work, so the Brief is the key. A new Brief is
a new Review Session — from a push (head moved) or a retarget (base moved)
alike; either way carry-over runs and the UI says work was carried forward.
The previous session becomes read-only once the reviewer materialises the
newer one (§3.4).

There is no `pull_request_id` column: it is derivable through the Brief, and
the delete cascade still reaches `pull_request` because `brief` already
cascades from it.

There is no explicit "Begin" operation. **The first write creates the
session**, as an idempotent upsert on the key. Reads never create sessions.

**One anchor rule:** the session names its Brief, the Brief names its head, so
no row repeats a SHA. `disposition.decided_at_sha` goes away; draft comments
carry no anchored-at SHA.

Rejected: keying on `(pull_request, reviewer, head_sha)`. The argument for it
was that every write operation is addressed by `(repoId, prNumber)` and none
takes a brief id, so an agent could work with no Brief present. Those
endpoints are PR-addressed because GitHub is PR-addressed, which says nothing
about what we persist, and there is no Brief-less review workflow in this
product.

Consequence accepted: a decision carried across three sessions exists as three
rows. That is the same rule draft comments already follow, it gives free
per-revision history, and "what did they decide about this flag" is answered
by the newest row rather than the only row.

---

## 2. Storage

### 2.1 The session row

```
review_session
  id                     surrogate PK
  installation_id        tenant column
  brief_id               FK brief (cascade)
  reviewer_id            GitHub numeric user id
  review_outcome         comment | approve | request-changes   (default: comment)
  begun_at
  UNIQUE (installation_id, brief_id, reviewer_id)
```

`review_outcome` stays a column because the picker must round-trip under
server-authoritative state. There is **no `submit_note` column**: the submit
wire carries `body` (§7.4), and a second home for one field is drift.

There is **no `granted_scope` column**. A human in the browser and their agent
on a Bearer token resolve to the same session row, so a scope there would
leash the human too. Scope lives on the credential (§5).

### 2.2 The six owned tables

```
review_draft_comment    review_session_id, file_path, side,
                        start_line, end_line, body,
                        status (draft | submitted),
                        anchor_status (null | moved | orphaned),
                        carried_from_session_id (nullable)

review_draft_reply      review_session_id, thread_root_comment_id, body
                        thread root is a GitHub id — durable, needs no anchoring

review_read_mark        review_session_id, chunk_id

review_group_reclassification
                        review_session_id, change_group_id, category
                        overrides only; the Brief supplies every default

review_submitted_review review_session_id, github_review_id
                        the own-comment join key for conversation reconciliation

disposition             (existing table, amended — see 2.3)
```

Draft comments keep the file-and-line coordinate whatever else changes: it is
the GitHub POST payload, and it is what `remapRanges` consumes at carry-over.

Dropped from what the browser stores today: the per-comment `collapsed` flag
(pure view state, stays client-side) and the full `dominants` map (only
reclassification overrides are stored; defaults come from the Brief).

### 2.3 `disposition`, amended

The existing table is reused rather than rebuilt. Its content anchoring —
file path, attribute, line region — is already exactly what ADR 0007 requires
and exactly what `remapRanges` consumes.

```
disposition
  + review_session_id      FK review_session (cascade)
  + carry_status           null | new | reopened | settled | dropped
  + evidence_status        null | missing-evidence
  − decided_at_sha         redundant under the anchor rule
  − pull_request_id        derivable through the session
  − reviewer_id            derivable through the session
  natural key: (review_session_id, file_path, attribute, region_start, region_end)
```

The table has zero readers and zero writers today, so the amendment is a
migration against an empty surface, not a data migration.

### 2.4 `hunk_span` — the durable carry-over hop

```
hunk_span                       -- same natural key family as comparison_marks
  installation_id
  pull_request_id
  baseline_sha                  -- the previous Brief's head
  head_sha                      -- this Brief's head
  spans                         -- JSON: [{ file, hunks: [{oldStart, oldLines,
                                --                          newStart, newLines}] }]
  UNIQUE (installation_id, pull_request_id, baseline_sha, head_sha)
```

Coordinates only, never line content — so it needs no
`persist_baseline_snapshot` gate, exactly like `comparison_marks`. Written by
the worker **before** the model call on the generate path, so a failed
generation still leaves a usable hop.

Why not extend `comparison_marks`: marks store added and removed ranges
*unpaired*, and `remapRanges` needs both sides of each `@@` header paired — a
pure-insertion hunk contributes an added range with no matching removed range,
so hunk spans cannot be reconstructed from a marks row. The marks body is also
a `.strict()` Zod shape with existing rows; a sibling table avoids migrating
them.

### 2.5 `brief.carried_chunk_ids`

```
brief
  + carried_chunk_ids     JSON string[] — the frozen chunk ids stitchBrief
                          already computes; empty for anchor_state
                          'fresh-restart' | 'none'
```

`stitchBrief` computes the carried set today (`carriedGroupIds` at
`packages/worker/src/task/anchoring.ts:228`, `carriedChunks` at `:445`) and
throws it away — only `anchor_state` and `anchor_reason` reach the row
(`packages/persistence/src/stores/artifact-store.ts:412-413`). Persisting it is
what makes read-mark carry exact (§3.6) with no line math.

### 2.6 `api_token.scope`

```
api_token
  + scope    read | private-write | external-write   NOT NULL, CHECK-constrained
```

The scope vocabulary **is** the write classification (§5.3) — BRIEF-122's
`read`/`draft`/`submit` ladder is the same three rungs under older names, and
one vocabulary for both keeps the check a lookup rather than a mapping.

Chosen at mint, immutable for the token's life. See §5.

### 2.7 `audit_log`, amended

See §8.2 for the full column list.

---

## 3. Carry-over

When the PR gets new commits, a new Brief is generated, which means a new
Review Session. Carry-over is what moves the previous session's work onto it.

**Marginal cost: zero model calls, zero GitHub calls.**

### 3.1 Vocabulary — nothing new is minted

ADR 0007 already ships two vocabularies and they are not duplicates. Both are
reused; nothing is invented.

- **Location anchoring — `moved` / `orphaned`.** Subject is a *location*.
  Applies to draft Comments, Chunk read marks, Change-group reclassifications.
  `remapRanges` (`packages/brief-core/src/diff/remap.ts:79`) already returns
  exactly this two-valued answer (`REMAPPED` / `DEMOTED`) and structurally
  cannot invent a third.
- **Carry-over status — `New` / `Reopened` / `Settled` / `Dropped`.** Subject
  is a *decision about a risk*. Applies to Dispositions only, which is what
  the vocabulary was minted for.
- Draft replies need neither: their coordinate is a GitHub thread-root comment
  id, which is durable.

Accepted cost: `Reopened` means two things depending on the reader — in a
Delta Brief, "touched since you last submitted" (Checkpoint span); in a Review
Session, "touched since your last session" (previous Brief → this Brief). The
fix is not a third word. **The span is never implicit** — a carry-over status
is always read off a stated span, and every surface that shows one states it.

### 3.2 Where the hops come from

`GET …/diff` (`packages/api/src/routes/repos/pr/reads.ts:580`) proxies an
arbitrary `base...head` compare live, but it fails in exactly the cases that
matter: a force-push baseline GitHub has garbage-collected (`diff_snapshot`,
ADR 0006 #8's durable baseline, is dead code with zero production callers),
and `DIFF_TOO_LARGE` above 300 files / 20k lines. So the hop is made durable
at push time instead: the worker already fetches the exact `prevHead → head`
patch and already runs `parseHunkSpans` inside `planAnchoredGeneration`; it
persists that parse as a `hunk_span` row (§2.4).

A new pure function **`remapThroughHops`** in `packages/brief-core` composes a
chain of hops — the reviewer may have missed several pushes — into one remap.
It is deterministic and has no I/O.

### 3.3 Granularity

**Range granularity, one `remapRanges` call per anchor.** Demotion is
all-or-nothing per call, so one call per anchor keeps one reviewer's comment
from demoting another's. This diverges deliberately from the worker's
file-level gates, which are about whole-Brief anchoring, not per-item
placement.

The model is declined for v1. ADR 0007 *permits* a model to locate a moved
item; it never requires one. The deterministic chain is free, and the delta
core cannot do this job at any price — its schema carries none of ADR 0007's
four carry-over fields, and the prompt forbids the model from attempting
carry-over (`packages/brief-core/src/generation/prompt.ts:340`). What the
deterministic path gives up: pure-move, reformat and rename relocation. Never
in the dangerous direction — an unplaceable anchor orphans, it never settles.

### 3.4 When carry-over runs

**Evaluated on read, materialized on the first write, inside one
transaction.**

- On read, no session row exists yet. The verdicts are computed in memory from
  the previous session's rows plus the composed hops, and returned with the
  session payload. Reads still never create sessions.
- The first write of the new session creates the session row, copies the
  carried rows onto it with their verdict columns set, and applies the write —
  all in one transaction. Any write operation can be the one that
  materialises; it is not a property of any single operation.
- A session **freezes** only when the reviewer materialises a newer one, never
  merely because a newer Brief exists. A frozen session refuses writes with
  `pr-changed-since-read` (409) — the existing code, not a new one.

Carry-over **copies** rows into the new session; it never points at the old
ones.

Eager-on-push was rejected. It is nearly free of I/O, but it races the
reviewer: a push does not stop somebody typing. Carry-over would run ~60s
after the push and copy what exists, while the reviewer's tab is still open on
the old Brief and keeps writing for another ten minutes. Those writes land in
the old session and nothing re-runs.

### 3.5 What carries, and how

| Carried thing | Rule |
| --- | --- |
| Draft comment | `remapRanges` through the composed hops → `moved` (silent) or `orphaned` (attention item) |
| Draft reply | Always carries, silently — keyed on a durable GitHub thread-root id |
| Disposition | Carry status per ADR 0007's ladder over the stated span; `Reopened` is an attention item, the rest are silent |
| Read mark | Carries **only** if its chunk id is in the new Brief's `carried_chunk_ids`; otherwise resets silently (§3.6) |
| Reclassification | Carries if the Change-group id survived descent (`packages/brief-core/src/diff/descent.ts:1-9`); otherwise dropped silently — the group it applied to is gone |
| Review outcome | **Does not carry** (§3.7) |
| Submitted comments, submitted review ids | Do not carry — GitHub owns them |

### 3.6 Read marks carry only against the persisted carried set

A read mark must never carry on a bare chunk-id match. `anchoring.ts:444-448`
seeds `usedChunkIds` from the **carried** chunks only, and a freshly-generated
chunk is re-minted (`:461`) only when it collides with a carried id — it is
never checked against the previous Brief's full id set. So chunk ids get a
**collision guard, not descent**, unlike Change-group ids which genuinely
descend by file overlap.

A read mark on old `c5` matching new `c5` would therefore mark a Chunk the
reviewer never opened as read — a silent rubber-stamp, the exact failure
direction ADR 0007's asymmetry exists to make structurally impossible, and
strictly worse than resetting the mark, which costs one scroll.

### 3.7 The review outcome does not carry

An `approve` picked against the old code, riding silently onto new commits, is
the one carry that can do real damage. A new session starts at `comment` —
already today's default, so nothing looks broken — and it needs no attention
item, because Submit makes the reviewer pick anyway.

### 3.8 Untrustworthy spans orphan everything

**Any untrustworthy span orphans every anchor in that hop chain**: a
force-push, a retarget, a truncated compare, a missing hop. Orphaned work is
never deleted, only unplaced — the reviewer re-anchors it or deletes it
themselves.

Two known sources, both accepted for v1:

- `fetchCompareDiff` hardcodes a three-dot compare
  (`packages/github/src/pull-request.ts:227`), so a same-base force-push
  reports `diverged` and its span stops being evidence. A two-dot span would
  fix it in one line, but that function is shared with the worker's Brief
  generation, so it carries its own blast radius. Out of scope; ticketed
  separately.
- `baseShaMoved` forces every group to re-look before the partition runs
  (`anchoring.ts:36-40`), so a retarget carries nothing structurally — only
  file-and-line anchored items can survive it.

### 3.9 Several pushes before the reviewer looks

Re-derived against the **newest Brief only**. A session exists only where the
reviewer wrote, so skipped Briefs hold no rows and there is nothing to
accumulate: Brief 7 (last session) → 8 → 9 → 10 (arrival) is **one**
evaluation over the composed hops, never three lists summed.

---

## 4. The attention list

### 4.1 It is a second list, not the one that ships

`deriveUnresolvedItems`
(`apps/web/src/features/review/utils/state.ts:94`, consumed only by
SubmitModal) already derives a loose-ends list on every render —
`open-risk`, `missing-evidence`, `unreviewed-core`, `draft-comment`,
`thin-dismissal`. It cannot drive the carry-over row: every one of its kinds
fires on a first-ever review where no push has happened, so a merged list
would claim carried work on a session that carried nothing.

Two derivations, **one shared item shape** (`UnresolvedItem`'s fields and its
jump-to-item mechanic), in the same module. The deciding asymmetry is the
input, not the kinds: the attention list also needs the previous-Brief →
this-Brief carry-over verdict, which the submit list has no use for.

### 4.2 A query, not a table

There is no attention table. Before materialization the list is computed in
memory (no session row exists yet). After materialization the verdict lives as
a status column on each carried row — `review_draft_comment.anchor_status`,
`disposition.carry_status`, `disposition.evidence_status` — and the list is a
query over those columns.

Recomputing from hops on every read was rejected: it re-orphans an anchor the
reviewer already fixed. "The reviewer dealt with this" has to be stored
anyway, so it is stored on the row it is about, where it cannot drift.

### 4.3 Three kinds

| Kind | Condition | Cleared by |
| --- | --- | --- |
| Orphaned draft anchor | `remapRanges` demoted the draft's range | `reanchor-draft-comment`, `delete-draft-comment` |
| Reopened Disposition | The flagged region was touched in the span | `address-risk`, `dismiss-risk` |
| `missing-evidence` | A carried Disposition whose evidence target is gone | `address-risk`, `dismiss-risk` |

The third kind reuses the existing `missing-evidence` name rather than minting
one: at materialization a dangling evidence pointer is **cleared**, which
leaves exactly the condition the submit list already names (addressed with no
proof). `carry_status` distinguishes carried from fresh; the displayed kind
and the clearing action are identical.

Everything else carries silently: `moved` anchors, draft replies, uncarried
read marks, undescended reclassifications.

### 4.4 The agent-facing shape

```ts
{ kind, subject, location, clearedBy: readonly ProductActionId[] }  // non-empty
```

**`clearedBy` is a list, not a single id** — two of the three kinds are
cleared by either of two operations, and a scalar field pushes a CLI back into
exactly the kind→command guessing the field exists to prevent. Every value
resolves to an operation in §9.

There is **no `clearableBy` field** in v1. It is additive later and no client
breaks, because the CLI branches on `clearedBy`.

### 4.5 Clearing is human-only

Whatever scope was granted, clearing an attention item is a human action.
Every clearing action is a judgment the Receipt attributes to the reviewer by
name. The guard is **one predicate in the operation handler layer**, covering
the clearing operations, so a later per-row rule flips one check rather than
several call sites. An agent still writes its own drafts freely under `draft`
scope; it just cannot be the actor that says a reopened risk is fine now.

Authorship is deliberately inseparable in v1 (§5.7): `actor_type`/`actor_id`
cannot tell a human from their agent, and no `author` column is added.

### 4.6 What the reviewer sees

The row exists **only when a previous session carried in**. Four states:

1. **First-ever session** — no row at all. The header already carries
   progress.
2. **Clean carry-over** — `Your review carried forward · 13 items · a84c1de →
   9f2c1aa · nothing needs a re-look`. No dismiss button: silent carry-over is
   invisible, and an unseen carry gets re-checked by hand.
3. **Items pending** — the list replaces the row, each item jumping to its
   location.
4. **Last item cleared** — back to state 2, never to nothing.

The row **always states the span** — short SHAs at both ends, plus a revision
count when more than one push happened. It never mentions the PR's own
activity; the revision-timeline banner already owns that.

All copy goes through `packages/i18n`. The prototype strings at `491846aa`
(`brief.prototypeCarryover.*`) are the starting draft, not the final keys.

---

## 5. Scope: what a credential may do

### 5.1 The premise correction

The server never learns that an agent is involved. A Bearer token is minted by
a human, in the browser, and an agent presenting it is indistinguishable from
that human at a terminal — `ViewerPrincipal` carries `channel: COOKIE |
BEARER` and nothing else. "The reviewer grants an agent authority" is only
ever "the reviewer mints a token that can do less."

Three sub-questions dissolve rather than resolve:

- **The browser is unlimited.** A cookie has no row to hold a scope, and the
  person is at the keyboard.
- **Scope cannot be raised mid-session.** The credential *is* the grant, so
  more authority is a new token; work done under the narrower one is
  untouched.
- **BRIEF-122's "Begin records granted scope" is void.** There is no Begin,
  and a scope the client asserts about itself enforces nothing.

### 5.2 Scope lives on `api_token`

Chosen at mint, immutable for the token's life. Not on the session row, not on
the request.

The threat closed, narrowly stated: *a long-lived credential sitting on disk
gets used for more than the person intended.* It does not close a program
driving a real browser session, and it never distinguishes an agent from its
owner.

### 5.3 The ladder is the write classification

`read` → `private-write` → `external-write`, cumulative. This is the
classification the Product Operation catalog already carries, renamed for
humans — no new descriptor field, no new vocabulary, no manifest ripple. Every
Review Session operation is `private-write`, so the mapping stays exact as the
surface grows.

Accepted cost, stated not hidden: `generate-brief` is a private write, so a
draft-scoped token can spend model money.

Scope values follow the persistence lockstep rule — `as const` map, SHOUT_CASE
keys, kebab-case values, plus a CHECK migration.

### 5.4 `agentAvailable` is deleted

The descriptor field goes. It enforced nothing — the real rule is the Bearer
path test in the gate (`packages/api/src/routes/authz.ts:166-176`) — and being
hand-typed at 23 declaration sites it was already wrong twice: `list-tokens`
and `list-installations` both live under `/api/auth/*`, return 401 to every
token, and were nonetheless parked as CLI-map gaps demanding a `mergebrief`
command. A field that looks like a permission while checking nothing is worse
than no field.

Rejected: renaming it to `tokenAvailable` (a truer name on a claim nothing
verifies is still a claim nothing verifies), and deriving it from the
`/api/auth/` path prefix inside the CI check (that only moves a hand-written
rule into a second copy).

The descriptor drops to four fields — `id`, `kind`, `classification`,
`endpoint` — and both declaration interfaces in `product-router.ts` lose it
too.

### 5.5 The CLI map becomes pure bookkeeping

Every operation in the manifest appears in
`packages/cli/product-operations.map.json` as exactly one of three shapes:

- `command` — a real `mergebrief` command;
- `gap` — dated, owned, temporary;
- `webOnly` — new; a permanent written reason, browser-only, no command will
  exist.

`entrySchema` gains the `{"webOnly": {reason, owner}}` variant, **absence from
the map becomes an error for every id**, and the summary counts `webOnly` from
entries rather than from the manifest. The check verifies completeness and
nothing else; it never reads or asserts anything about tokens, because
enforcement is a separate and real check.

### 5.6 Where the check runs

**Authentication stays middleware. The scope check moves into
`productRouter.action()` and `.query()`**, reading the write class already on
the declaration they receive. A route added next year is enforced whether or
not its author thought about it. This takes ADR 0039's "descriptors never
touch a request" amendment.

Addressing rules:

- **A write names its Brief explicitly; a read derives the newest.** Deriving
  on a write would break the freeze rule by redirecting a stale tab's work
  into a session it has never seen.
- A frozen session reuses `pr-changed-since-read` (409) rather than minting a
  code.
- The refusal for insufficient scope is a new `scope-exceeded` at **403**. The
  404-collapse posture is spent once repo access is proven.

### 5.7 Backfill and authorship

- **Existing tokens backfill to `external-write` (full).** Read-only would 403 every
  running CLI on deploy day in installs with no operator on hand.
- **Authorship is deliberately inseparable in v1.** `actor_type` is
  `reviewer | app | system`, and a human in the browser and their token-holding
  agent write an identical row — same type, same numeric id. The answer is to
  accept that: the reviewer invoked the agent, so the write is theirs, exactly
  as on GitHub where a comment posted with your token is from you. No `author`
  column on the five carried tables and no token-id column. It becomes
  separable only under a second identity (a GitHub App acting as a bot), which
  is out of scope.

---

## 6. How the web app writes

### 6.1 Server-authoritative with an optimistic local copy

No offline queue, no background sync, no conflict resolution. Two writers on
one session resolve **last-write-wins per row**, each write being an upsert on
session + subject. The failure accepted: a write that fails is not saved, and
the reviewer is told — nothing lands silently later.

### 6.2 One operation per user action

**Never a snapshot PUT.** A snapshot clobbers a concurrent writer's untouched
fields, leaves the audit trail unable to say what the reviewer did, and makes
the scope check meaningless because every action arrives as the same
operation. Cost accepted: the operation list gets long, and each entry needs a
handler, a catalog row and a CLI-map row.

**No batching rule and no network debounce.** The write-volume premise was
wrong: read marks fire on an explicit click
(`apps/web/src/features/review/hooks/useReadingSession.ts:555`), and composer
text stays in component state until blur or Save
(`ReplyComposer.tsx:130`, `:147`). Every store write today is already one
deliberate user action; today's 250 ms debounce exists because the subscriber
rewrites the whole snapshot, not because writes are frequent.

Bulk dismiss and bulk address already arrive as one call carrying an array of
ids — that is the operation's shape, not batching.

### 6.3 Failure and recovery

**No retry machinery at all** — a retry here is just the action again. On
failure the UI returns to the state where that same action is still available:
the checkbox un-ticks, the composer stays open holding its text.

That makes the composer **close on write success rather than on click** — one
round trip of "Saving…" where today it is instant. In exchange there is no
unsaved-marker state, no retry button, and no action ever half-applied on
screen. Errors surface; nothing retries itself.

### 6.4 First paint

The session read joins the **route loader**, in parallel with the Brief
artifact, so the first paint already shows marks, drafts and dispositions.
This is strictly better than today, where the provider hydrates in an effect
(`provider.tsx:94`) and the first paint is unmarked. The read is pure — it
never creates the session row.

The loader **degrades rather than fails**: if the session read errors, the
Brief still renders, the session shows as unavailable, and **writes are off**
in that state — not because a write would corrupt anything, but because the
reviewer would be typing into a screen hiding their earlier drafts, and the
likely result is a duplicate of a comment they already wrote.

Streaming (a deferred loader read) was rejected: the loader already blocks on
the larger artifact read, so deferring the session buys zero milliseconds.

### 6.5 Picking up another writer's work

**Refetch on window focus.** No polling, no live channel. The payload scales
with reviewer actions rather than PR size, so a focus refetch is cheap. A CLI
write made while the tab was in the background appears when the reviewer comes
back to it.

### 6.6 A frozen session is terminal for the screen

Not a per-action failure. When a write returns `pr-changed-since-read` (409),
the screen goes read-only behind the revision banner that already ships, with
no local drafting. The reviewer moves to the new Brief, where their work has
carried.

### 6.7 Migration and brief kinds

- **Existing browser sessions are dropped, not migrated.** `sessionStorage`
  already dies with the tab, and an import path would have to materialize a
  session from a read, which §3.4 forbids. Accepted: a tab left open across
  the deploy loses its marks.
- **One persistence model, no split by brief kind.** File-backed briefs
  (`tools/categorizer/out`, id = filename, `brief.server.ts:106`) have no
  `brief` row, no installation and no reviewer, so they carry no session at
  all and render read-only until they have DB rows. Ingesting those artifacts
  into normal DB briefs is carried to BRIEF-98 — an ingest of existing
  artifacts, not a regeneration, so no model spend. This spec does not block
  on it: local review-flow testing runs on directly seeded DB briefs (the
  `pullRequests.upsert` + `artifactStore` path in `.claude/skills/verify`).

---

## 7. Stopping one comment from posting twice

### 7.1 The server builds nothing

No idempotency key, no in-flight state, no read-back.

Only three of the six external writes create an object per call. Of the four
duplicate sequences, only **retry after an ambiguous failure** survives
scrutiny: two live clients and two tabs are deliberately not designed for, and
cross-session duplication is already dead once state lives on the server.

A cited fact was wrong and is corrected here: ADR 0029's exit 5 is 4xx
validation only, so the CLI contract never tells an agent to re-fire an
unknown-outcome write.

Supporting evidence: GitHub, Slack and X ship no idempotency key for a post
either (Stripe has one because a charge is irreversible; a comment is
deletable), GitHub does not dedupe, and a doubled post-now makes **two
parallel threads on one line** rather than one doubled thread — only replies
join a thread.

What is covered comes free from state living on the server: a lost *response*
finds the row already `submitted`. What is not covered — our call to GitHub
timing out after it wrote — is **accepted**.

### 7.2 The client rule

- Never auto-retry a write whose outcome is unknown.
- One in-flight request per draft — a disabled button, not a protocol.

### 7.3 What gets deleted

`postComment.ts`'s per-tab in-flight registry, settled queue and
drain-on-mount all go. Their only reason was a browser store that died on
remount.

### 7.4 Submit publishes the drafts the server already holds

Wire: `{ briefId, outcome, body }`. No `comments[]`.

This is not a fork of the flow — it is "same as today, store on the server",
since drafts already save as they are written. Consequences:

- The 100-comment cap moves from the request to the session.
- A double-fired Submit costs one empty review instead of 60 doubled comments.
- An agent writes drafts and then submits, which is what makes its comments
  persistent, carried and auditable.

A repeat naming an already-published draft is **refused, not receipted**: a
new `draft-already-published` at **409**. A success for a call that wrote
nothing would record a phantom post, and a specific "already published"
message does not invite the manual re-post a generic failure would.

---

## 8. The audit trail

### 8.1 What is recorded

**Every action, plus denials. Never a read.**

Reads are the firehose and the pointless half — 13 of 23 operations today,
firing on every render and refetch-on-focus, already producing an `api.access`
line each, and leaving nothing to account for. Actions are bounded by human
clicks (§6.2): ~10 action operations today, 21 after this spec.

Accepted cost: the log cannot answer "what did this token *see* before we
revoked it" — exfiltration is a read, and reads are out.

The emit lives at the **single `productRouter.action()` choke point**, not the
nine hand-placed sites. Hand-placed emits are how `AuditAction.CONFIG` came to
be declared in `types.ts` and emitted nowhere.

### 8.2 What a row carries

```
audit_log
  id, occurred_at, installation_id, actor_type, actor_id,
  target_type, target_id, metadata                     (kept)

  + operation        descriptor id — replaces `action`
  + classification   private-write | external-write
  + channel          cookie | bearer | webhook | worker
  + credential_id    api_token.id or auth_session.id — a plain number
  + outcome          ok | denied | failed
  + request_id       joins the api.access line
  + client           user-agent-derived, forensic only (§8.6)
  + caller_ip        NULLABLE — populated only under the operator PII flag (§8.7)

  − action           the eight-value vocabulary
```

`operation` replaces `action` because "submit" currently collapses posting,
replying and submitting a review into one word. `classification` is the column
an operator actually queries — "everything that left this instance" should not
require knowing which forty ids are external. `outcome` exists because the
table only ever recorded denials, so it never needed to say how something
ended.

The audit row **loses its HTTP status**: today's `{decision:"404"}` is the
no-existence-leak collapse, not absence of a status.

### 8.3 Parameters: no bodies, ever

**Ids, tokens and numbers. No bodies, no free text, no truncation.**

An audit row answers what was *done*; a body is what was *said*, and every
body is already stored in the row it points at (the duplicate-post decision
keeps drafts through submit rather than consuming them, so the local copy
survives publication). The only unrecoverable body is a *denied* action's —
precisely the content least worth keeping.

The rule also survives its own weakened justification: ADR 0023 killed the
hosted arm, but retention has a "never" setting adopters will use, and
`operations.md` tells every adopter to `pg_dump` a volume it says contains the
audit log, so anything stored lands in every backup copy they keep.

**The closed key allowlist inverts to open keys, closed values.** Metadata
accepts any key; values must be a token, a number, or a boolean. The value
rules were always the protection — the key list only made every new emit a
code change. This rewrites `packages/persistence/AGENTS.md`'s audit invariant
(three of its four clauses no longer hold: numeric-only, closed key allowlist,
never purged).

### 8.4 Retention

**A policy knob, not a disk one.** ~500k rows/year ≈ 150MB, dwarfed by `brief`
and `delta`.

- `AUDIT_RETENTION_DAYS` — unset = keep forever = the default.
- **30-day floor** when set, because audit must outlive a Review Session.
- Erasure is a documented `delete … where actor_id` in
  `docs/self-host/operations.md`, not a feature.

The premise that `purgeRoutines` already sweeps everything else was false:
`setRetention` and `sweepExpired` have zero production callers, and the worker
has no cron at all (graphile's scheduled-job support is unused). So the build
plan carries **the system's first scheduled job**, and the audit sweep is the
one purge that is instance-wide rather than ctx-bound.

### 8.5 The opt-out

**One boolean: `AUDIT_PRIVATE_WRITES`, default on.**

External writes and denials are never switchable — an instance able to post to
GitHub with no record is not a configuration. Per-field anonymisation was
rejected as false privacy.

### 8.6 The two logs stay separate

Transport (`api.access`) versus intent (`audit_log`), joined on `reqId`.
`api.access` gains an `operation` field (ADR 0034 amendment).

CLI version gets built — `user-agent: mergebrief/<version>`, ~5 lines, since
`packages/cli/src/client.ts` sends no user-agent today — under one hard rule:
**nothing may ever branch on it.** A client-asserted value is forensic, never
load-bearing.

### 8.7 Caller IP

A **nullable** `caller_ip` column whose population is governed by an operator
PII flag. Nullable is the load-bearing part: the column exists
unconditionally, so turning collection on or off is a config change and never
a migration, and a row written under the flag-off posture is honestly empty
rather than absent.

**Recommended default: off.** In a single-tenant self-host deploy the
credential identifies the caller far better than an address does, and the
privacy cost is the highest of any field.

**Caveat the docs must state:** behind a reverse proxy the observed address is
the proxy's unless `X-Forwarded-For` is explicitly trusted. Trusting a
client-settable header is its own decision and is not made here — v1 records
the socket address and says plainly what that means behind a proxy.

**Surface: instance config, never repo config.** ADR 0032 §1 draws the line —
instance config belongs to whoever pays and operates; repo config
(`.mergebrief/`) belongs to whoever owns the code, and may only *narrow*
instance behaviour. All three audit knobs (`AUDIT_RETENTION_DAYS`,
`AUDIT_PRIVATE_WRITES`, the PII flag) belong on **one** surface — splitting one
feature's configuration across env and YAML is the drift worth avoiding.

**Chosen surface: env, via `packages/persistence/src/db/config.ts`**, which
already carries the PII-minimization family (`PERSIST_BASELINE_SNAPSHOT`,
`STORE_DISPLAY_NAMES`) with a comment saying the defaults encode the self-host
posture. Choosing `mergebrief.config.yaml` instead would make the
instance-config loader stop being generation-only, since `packages/api` (the
emit) and `packages/worker` (the sweep) would both have to read it — a wider
change for no gain the env family does not already give.

### 8.8 No read surface in v1

Operator, `psql`, documented queries. Who may read the audit log is its own
authority question, and answering it badly is worse than not shipping a
reader.

---

## 9. The operation surface

**35 operations: 14 queries, 21 actions** — 14 `read`, 15 `private-write`,
6 `external-write`. Twelve are new, eleven of the existing 23 are unchanged,
twelve take an amendment, none is deleted.

### 9.1 The twelve new operations

| id | kind | classification | tables | endpoint | CLI map |
| --- | --- | --- | --- | --- | --- |
| `read-review-session` | query | read | `review_session` + six owned + `hunk_span` | `GET /api/repos/:repoId/pulls/:prNumber/session` | gap |
| `create-draft-comment` | action | private-write | `review_draft_comment` | `POST …/session/comments` | gap |
| `update-draft-comment` | action | private-write | `review_draft_comment` | `PATCH …/session/comments/:draftId` | gap |
| `reanchor-draft-comment` | action | private-write | `review_draft_comment` | `PUT …/session/comments/:draftId/anchor` | gap |
| `delete-draft-comment` | action | private-write | `review_draft_comment` | `DELETE …/session/comments/:draftId` | gap |
| `save-draft-reply` | action | private-write | `review_draft_reply` | `PUT …/session/replies/:threadRootCommentId` | gap |
| `set-chunk-read` | action | private-write | `review_read_mark` | `PUT …/session/chunks/:chunkId/read` | gap |
| `dismiss-risk` | action | private-write | `disposition` | `POST …/session/risks/dismiss` | gap |
| `address-risk` | action | private-write | `disposition` | `POST …/session/risks/address` | gap |
| `reopen-risk` | action | private-write | `disposition` | `POST …/session/risks/reopen` | gap |
| `reclassify-group` | action | private-write | `review_group_reclassification` | `PUT …/session/groups/:groupId/classification` | gap |
| `set-review-outcome` | action | private-write | `review_session` | `PUT …/session/outcome` | gap |

Every one of the eleven new write operations also touches `review_session`:
the first write creates the row and materialises carry-over in the same
transaction, so "which write materialises" is not a property of any one
operation.

`read-review-session` returns the attention list **inside** the session
payload rather than as a thirteenth operation. It keeps the route loader at
one session read and the CLI at one call, and costs nothing in audit (reads
are never recorded). A separate `read-attention-list` was rejected: the list
is a projection of status columns on rows the session read already returns.

### 9.2 Why these shapes

- **Read marks are one operation carrying a boolean, not two.** A toggle is
  not idempotent, and "a retry is the action again" (§6.3) requires
  re-sending a failed write to be safe. The audit value rules already admit
  booleans, so mark-vs-unmark stays legible in the log without a second id.
- **Dispositions are three operations, not one.** `dismiss-risk` (a reason),
  `address-risk` (per-flag evidence) and `reopen-risk` (a bare undo) carry
  materially different payloads and record different judgments. All take an id
  array, matching the bulk shape the store already uses.
- **`toggleComment` gets no id.** Per-comment collapse was dropped from the
  persisted set; it is local view state.
- **No `save-submit-note` operation.** The submit wire carries `body`; the
  session row has no note column (§2.1).

### 9.3 "Clear local drafts" is deleted

The button ships today
(`apps/web/src/features/brief/components/BriefScreen/BriefScreen.tsx:587`,
`clearSnapshots()` + `actions.reset(...)`) and wipes the whole session in one
click. **It is deleted, and it gets no operation.**

It existed to escape a browser store that was invisible and untrustworthy —
the server store is neither. Meanwhile its blast radius grew: the browser
version wiped work that died with the tab regardless, while a server version
would wipe durable work that survives the tab, the device, and the reviewer's
memory of having done it.

With the wide undo gone, a mis-dismissed risk needs a narrow one, so
**`reopen-risk`** ships in its place with the UI affordance its long-orphaned
store branch never had (`disposeFlag(ids, {kind:"open"})` exists in the store
and has never had a caller — `useRiskFlagModalsFacade.ts:87`/`:120` pass only
`dismissed` and `addressed`).

### 9.4 Every web action maps to exactly one id

| Web action (`session/store.ts`) | Operation |
| --- | --- |
| `reviewChunk` | `set-chunk-read` |
| `disposeFlag` (dismissed) | `dismiss-risk` |
| `addressFlags` | `address-risk` |
| `disposeFlag` (open) | `reopen-risk` |
| `reclassifyGroup` | `reclassify-group` |
| `saveComment` | `create-draft-comment` |
| `updateComment` | `update-draft-comment` |
| `deleteComment` | `delete-draft-comment` |
| `setReplyDraft` | `save-draft-reply` |
| `setOutcome` | `set-review-outcome` |
| `toggleComment` | none — local view state |
| `markCommentsSubmitted`, `recordSubmittedReview` | none — server-side effects of `submit-review` |
| `reset` | **deleted with the button** |
| post now (`postInlineComment`) | `create-inline-comment` |
| post a reply | `reply-to-comment` |
| submit | `submit-review` |

### 9.5 The existing 23

**Unchanged (11):** `list-pulls`, `list-repos`, `list-collaborators`,
`read-pull`, `read-brief`, `read-brief-context`, `read-conversation`,
`read-delta`, `read-diff`, `read-marks`, `read-narrative`.

**Amended (12):**

- All 23 lose `agentAvailable` (§5.4).
- `submit-review` — wire becomes `{briefId, outcome, body}` with no
  `comments[]`; publishes the drafts the server holds, flips their status,
  records the review id. The 100-comment cap moves to the session.
- `create-inline-comment`, `reply-to-comment` — name a draft the server holds;
  a repeat naming an already-published draft is refused with
  `draft-already-published` (409).
- `resolve-thread`, `unresolve-thread`, `mark-ready` — unchanged behaviour,
  but they join the scope check and the audit emit at the router seam.
- `generate-brief` — unchanged; a draft-scope token can call it, and that
  model spend is accepted.
- `mint-token` — takes a scope at mint, immutable thereafter; `list-tokens`
  shows it. `revoke-token`, `select-installation` — unchanged behaviour, newly
  explicit in the CLI map.

**Nothing is deleted.**

### 9.6 Final CLI-map shape

**9 commands, 21 gaps, 5 web-only = 35.**

- **Closed as corrections:** `list-tokens` and `list-installations` become
  `webOnly`. Both are `/api/auth/*`, both return 401 to every token, so their
  gap entries always described a command that could never work. (Two of the
  four gaps ticketed BRIEF-201.)
- **Newly explicit `webOnly` (3):** `mint-token`, `revoke-token`,
  `select-installation` — web-only today by a field that no longer exists.
- **Still gaps (2 of the four BRIEF-201 gaps):** `generate-brief`,
  `list-collaborators`.
- **The 7 gaps ticketed BRIEF-197 are re-ticketed to BRIEF-201**, expiry
  2026-12-31. This map ruled CLI commands out of scope, so BRIEF-197 closes
  without shipping them and their expiry would otherwise point at a closed
  ticket. The 12 new gap entries above are BRIEF-201's too, same expiry.

---

## 10. New wire error codes

Both follow `packages/api/AGENTS.md`'s recipe (code + status + English
template, the identical `errors.<code>` template in `packages/i18n`, the
`apps/web` mirror).

| Code | Status | Meaning |
| --- | --- | --- |
| `scope-exceeded` | 403 | The credential's scope does not reach this operation's class. |
| `draft-already-published` | 409 | The named draft has already been published to GitHub. |

Reused, not minted: `pr-changed-since-read` (409) for a write against a frozen
session.

---

## 11. Configuration

| Knob | Surface | Default | Effect |
| --- | --- | --- | --- |
| `AUDIT_RETENTION_DAYS` | env (`persistence/db/config.ts`) | unset = keep forever | Sweep audit rows older than N days; 30-day floor when set |
| `AUDIT_PRIVATE_WRITES` | env | on | Record private writes; external writes and denials are never switchable |
| `AUDIT_CALLER_IP` | env | off | Populate `audit_log.caller_ip` with the socket address |

---

## 12. Out of scope

Recorded so a later effort finds them, not deferred work inside this one.

- **New CLI commands for the Review Session operations.** BRIEF-198 owns
  capability discovery; BRIEF-201 owns the remaining catalog commands. This
  spec decides the operations, not their commands.
- **The autonomous reviewer that submits under a bot identity.** Parked
  deliberately by BRIEF-122. The scope design must not paint it out, but it is
  a different destination — and it is the only thing that would make agent
  authorship separable (§5.7).
- **A two-dot compare so anchors survive a force-push** (§3.8).
- **Rate limiting on the write routes.** A real concern, but a general
  API-hardening one that applies to every route.
- **Mirroring per-Chunk read marks into GitHub's own per-file Viewed
  checkbox.** GitHub exposes `markFileAsViewed` / `viewerViewedState`
  (VIEWED / UNVIEWED / DISMISSED) through GraphQL. A plausible later nicety.
