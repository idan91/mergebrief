# 0040 — Review Session: server-backed store, carry-over, and credential scope

Status: accepted (2026-08-17). Decided on BRIEF-197 (wayfinder map: ten
tickets, nine decisions). Specification:
`docs/plans/brief-197-review-session-spec.md`; build plan:
`docs/plans/brief-197-review-session-implementation.md`.

A reviewer's unfinished work — draft comments and replies, per-Chunk read
marks, Change-group reclassifications, Flag **Dispositions**, the chosen
outcome — moves from the browser to our own Postgres, in a **Review Session**
row keyed by the **Brief** it was done against. New commits produce a new
Brief, therefore a new Review Session, and prior work is carried onto it by a
deterministic hop composition with **zero model calls and zero GitHub calls**.
What a credential may do is a **scope on the token**, not on the session, and
it is the write classification the Product Operation catalog already carries.

## Context

ADR 0004 named the reviewer's workspace private and said it "must persist
reliably per (PR × reviewer) — loss of this state is loss of trust". ADR 0022
gave it a client runtime and deliberately deferred both persistence and
region-anchored keying until push→regenerate and a persistence layer existed.
Both now exist. What ships today is `sessionStorage`: it dies with the tab, is
invisible to any other client, and cannot be read by an agent at all.

Three things forced the design past "add a table".

**GitHub cannot be the drafting backend.** Verified against GitHub's OpenAPI
description and published GraphQL schema (2026-08-16): REST cannot add a
comment to an existing pending review (no `pull_request_review_id` parameter
exists — GraphQL only), a provisional outcome cannot be stored on a pending
review at all, GitHub nowhere documents what happens to pending review
comments after a push, and it has no home for a Disposition, a per-Chunk read
mark, or a reclassified Change group.

**Carry-over stopped being hypothetical.** ADR 0007 specified the vocabulary
(`moved`/`orphaned`, `New`/`Reopened`/`Settled`/`Dropped`) but nothing durable
existed to re-place: `disposition` has zero readers and zero writers, and the
Delta Brief carries none of ADR 0007's carry-over fields. Meanwhile
`remapRanges` — deterministic, hunk-header-only, demoting rather than guessing
— was already built and tested.

**BRIEF-122 assumed an authority model that the server cannot see.** It
specified "Begin records granted scope (read/draft/submit)". But a Bearer
token is minted by a human in the browser, and an agent presenting it is
indistinguishable from that human at a terminal; the server never learns an
agent is involved.

## Considered Options

- **Where unfinished work lives.** *GitHub pending reviews* — rejected on the
  capability facts above. *Browser storage, kept* — rejected: an agent cannot
  read it, and it dies with the tab. **Our own server store (chosen)** —
  GitHub stays the publish target at Submit, never the drafting backend.
- **Session key.** *`(pull_request, reviewer, head_sha)`* — argued for because
  every write endpoint is PR-addressed and none takes a brief id. Rejected:
  those endpoints are PR-addressed because *GitHub* is, which says nothing
  about what we persist, and there is no Brief-less review workflow.
  **`(installation, brief, reviewer)` (chosen)** — the Brief drives the work,
  so a new Brief (push or retarget) is a new session, and every coordinate
  anchors at the session's Brief head, so no row repeats a SHA.
- **When carry-over runs.** *Eagerly on push* — nearly free of I/O, since the
  worker already fetches the `prevHead → head` patch and already parses its
  hunks. Rejected: it races the reviewer, whose open tab keeps writing into
  the old session for another ten minutes after the copy. **Lazily on the
  reviewer's arrival, off a hop persisted at push time (chosen)** — evaluated
  on read, materialized on the first write, in one transaction.
- **Carry-over mechanism.** *A model pass to relocate moved anchors* (ADR 0007
  permits it). Rejected for v1: the deterministic chain is free, the delta
  core cannot do the job at any price, and declining costs only pure-move,
  reformat and rename relocation — never in the dangerous direction.
  **Deterministic `remapRanges` over composed hunk spans (chosen)**, range
  granularity, one call per anchor.
- **Where scope lives.** *On the session row* — rejected by the keying: a
  human and their agent share one row, so a scope there leashes the human.
  *On the request* — a client-asserted scope enforces nothing. **On
  `api_token`, chosen at mint, immutable (chosen).**
- **Audit emit site.** *Keep the hand-placed emits* — rejected; that is how
  `AuditAction.CONFIG` came to be declared and emitted nowhere. **One emit at
  the `productRouter.action()` choke point (chosen)**, which the scope
  decision had already made descriptor-aware.

## Decision

1. **A Review Session is a row keyed `(installation_id, brief_id,
   reviewer_id)`**, owning five tables — draft comments, read marks,
   reclassifications, `disposition` (reused, session-linked), submitted
   review ids. **The first write creates the session**; reads never create
   one. There is no Begin operation.
2. **"Mind-Map Space" is retired; Review Session is the term.** `CONTEXT.md`'s
   **Session baseline** becomes the durable key of a Review Session rather
   than a transient label. **Checkpoint** is unchanged.
3. **Carry-over is deterministic and free.** The worker persists the paired
   `@@` hunk spans it already parses into a `hunk_span` sidecar (coordinates
   only, same key family as `comparison_marks`, written before the model
   call); a new pure `remapThroughHops` composes those hops when the reviewer
   arrives. No new vocabulary — ADR 0007's two vocabularies are reused, with
   **the span always stated**, because a Review Session's span (previous Brief
   → this Brief) is not the Checkpoint span.
4. **Any untrustworthy span orphans every anchor** — force-push, retarget,
   truncated compare, missing hop. Orphaned work is never deleted, only
   unplaced. Read marks carry **only** against the Brief's persisted
   carried-chunk set, never on a bare chunk-id match (chunk ids get a
   collision guard, not descent). **The review outcome does not carry.**
5. **The attention list is a second derivation, not a table.** Three kinds —
   orphaned draft anchor, reopened Disposition, carried Disposition whose
   evidence target is gone — with the verdict stored as a status column on the
   carried row, so an item the reviewer already fixed cannot re-open itself.
   Its wire shape carries `clearedBy` as a **list** of operation ids.
   **Clearing is human-only in v1**, guarded by one predicate in the handler
   layer.
6. **Scope is a column on `api_token`**, chosen at mint, immutable. The
   ladder **is** the write classification — `read` / `private-write` /
   `external-write`, cumulative. A cookie has no scope: the browser is
   unlimited. **`agentAvailable` is deleted** from the descriptor; the CLI map
   gains a permanent `webOnly` variant and absence from the map becomes an
   error for every id. **Existing tokens backfill to full.**
7. **The scope check runs inside `productRouter.action()`/`.query()`**, off
   the class already on the declaration. Authentication stays middleware.
   A write names its Brief explicitly; a read derives the newest. Insufficient
   scope is `scope-exceeded` (403); a write against a frozen session reuses
   `pr-changed-since-read` (409).
8. **The web app is server-authoritative with an optimistic local copy** — one
   operation per user action, never a snapshot PUT; last-write-wins per row;
   no batching, no debounce, no retry machinery (a retry is the action again,
   so the UI returns to the state where the action is still available). The
   session read joins the route loader and degrades rather than fails; a CLI
   write is picked up by refetch on window focus. Existing browser sessions
   are dropped, not migrated.
9. **Nothing is built to stop a double post.** No idempotency key, no
   in-flight state, no read-back: what is covered comes free from state living
   on the server; our call to GitHub timing out after it wrote is accepted.
   **Submit publishes the drafts the server already holds** (`{briefId,
   outcome, body}`), moving the 100-comment cap to the session; a repeat
   naming an already-published draft is refused with `draft-already-published`
   (409). The per-tab in-flight registry in `postComment.ts` is deleted.
10. **The audit trail records every action plus denials, never a read**, from
    the single router choke point. `action`'s eight values are replaced by the
    descriptor's `operation` id, alongside `classification`, `channel`,
    `credential_id`, `outcome`, `request_id`, `client`, and a nullable
    `caller_ip`. **No bodies, no free text, no truncation**; the closed key
    allowlist inverts to **open keys, closed values**. Retention is a policy
    knob (`AUDIT_RETENTION_DAYS`, unset = forever, 30-day floor when set), the
    opt-out is one boolean (`AUDIT_PRIVATE_WRITES`, default on, external
    writes and denials never switchable), and caller IP is off by default
    behind an operator PII flag. **No read surface in v1.**
11. **The surface is 34 operations** — 14 queries, 20 actions; 14 `read`, 14
    `private-write`, 6 `external-write`. The "Clear local drafts" button is
    **deleted** and gets no operation; **`reopen-risk`** ships in its place.

## Why This Way

The keying is the load-bearing choice, and everything cheap follows from it.
Because a session names a Brief and a Brief names its head, no row has to
carry an anchor SHA, "the previous session" is well-defined without a pointer,
and the chunk-id ambiguity that made read marks dangerous dissolves into a set
membership test against a value the worker already computes and throws away.

Carry-over is deterministic because the safe error is cheap and the dangerous
one is not. ADR 0007's asymmetry — a false `Settled` is a silent rubber-stamp,
a false `Reopened` costs a glance — is preserved structurally: `remapRanges`
can only say remapped or demoted, an untrustworthy span orphans everything,
and a read mark can never claim code the reviewer has not seen. A model pass
would buy relocation across renames and reformats; it would also introduce the
one class of error the product exists to prevent, at a per-arrival cost, for a
case a reviewer resolves with one click.

Scope moved to the credential because the alternative was theatre. The server
cannot see an agent, so the only honest thing a limit can attach to is the
thing a person hands over: a token on disk. That also explains deleting
`agentAvailable` rather than fixing it — a field that reads as a permission
while checking nothing is worse than no field, and its two provably wrong
values were sitting in the manifest unnoticed. Reusing the existing write
classification as the ladder means the surface cannot outgrow the enforcement:
a new operation must pick a class, and picking a class *is* declaring who may
call it.

The audit change is mostly subtraction. Recording actions and not reads keeps
the ledger bounded by human clicks; recording what was done and not what was
said keeps every body in the row that already owns it; and emitting from the
one place every action already passes through means the trail cannot rot the
way nine hand-placed emits did.

## Consequences

- **Amends ADR 0004** — the private workspace is Review Session, and it now
  has the durable per-(PR × reviewer) home ADR 0004 required.
- **Amends ADR 0022** — the client store stops being the source of truth and
  its `sessionStorage` snapshot is deleted; the deferred region-anchored
  keying is now live, keyed through the session's Brief.
- **Amends ADR 0039** — descriptors *do* touch a request: the scope check runs
  inside `productRouter.action()`/`.query()`. `agentAvailable` leaves the
  descriptor, and the CLI-map gate inverts (every id must appear; `webOnly` is
  a map entry, not a manifest-derived absence).
- **Amends ADR 0034** — `api.access` gains an `operation` field, and the two
  logs stay separate (transport vs intent, joined on `reqId`).
- **Amends ADR 0018** — `audit_log` gains eight columns and loses `action`;
  its numeric-only rule is restated on self-host grounds (backups, a "never"
  retention setting) rather than "never purged", since retention becomes
  configurable. `disposition` is amended, and `hunk_span` plus six
  session-owned tables are added.
- **Amends ADR 0016** — an API token now carries a scope chosen at mint;
  #12's audit boundary keeps its emit interface but changes vocabulary.
- **First scheduled job in the system.** `setRetention`/`sweepExpired` have
  zero production callers and the worker has no cron; the audit sweep wires
  graphile's scheduled-job support for the first time, and it is the one purge
  that is instance-wide rather than ctx-bound.
- **`packages/persistence/AGENTS.md`'s audit invariant is rewritten** — three
  of its four clauses no longer hold (numeric-only, closed key allowlist,
  never purged).
- **Two renames ride the build stack**: `MindMap*` → `ReviewSession*` (33
  files) and `reviewer_session` → `auth_session` (20 files, clearing the name
  collision the product term creates).
- **Deliberately inseparable authorship.** `actor_type`/`actor_id` cannot tell
  a human from their agent; the reviewer invoked the agent, so the write is
  theirs. Separable only under a bot identity — out of scope, and the one
  parked item this decision must not paint out.
- **Accepted, stated not hidden:** a draft-scoped token can call
  `generate-brief` and spend model money; a GitHub write that succeeds after
  our call times out can double-post; a tab left open across the deploy loses
  its marks; file-backed briefs carry no session until BRIEF-98 ingests them.
