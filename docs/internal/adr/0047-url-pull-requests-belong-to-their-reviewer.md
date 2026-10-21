# 0047: A URL pull request belongs to the reviewer who pasted it

Status: accepted
Date: 2026-08-25

Amends ADR 0018 (every row carries an `installation_id`) and the tenancy
rule of ADR 0016: a second scope exists beside the Installation.

## Context

- ADR 0018 keyed every row on `installation_id`, and the storage layer scoped
  every read and write by it. A pull request could reach MergeBrief one way
  only: the App's webhooks, from a repository inside an Installation.
- Home gained an input where a Reviewer pastes a pull request URL. The
  repository may sit in no reachable Installation, public or private, so
  no webhook reports on it and no App credential can read it. The row still
  needs a Brief, a Review Session, generation records and an audit trail,
  and it must not land in anyone's Installation.
- A pasted private repository the App is not installed on may still be
  readable to the Operator. Reading it on the Operator's behalf for every
  reviewer would hand the instance's credential to anyone with a login.

## Decision

- **Source is a stored fact.** `pull_request.source` names which way the row
  entered: `installation` or `url` (`PullRequestSources`,
  `packages/types/src/pull-requests.ts`). `audit_log.source` carries the same
  vocabulary.
- **A URL pull request has an owner, not an Installation.** `installation_id`
  is nullable on `pull_request` and on every child table (migration
  `packages/persistence/drizzle/0033_url-brief-tenancy.sql`). The
  `pull_request_owner_shape` CHECK pairs exactly one scope with the source:
  an `installation` row carries `installation_id` and no `owner_user_id`; a
  `url` row carries `owner_user_id` and a NULL `installation_id`
  (`packages/persistence/src/schema/pull-request.ts`). The partial unique
  index `pull_request_owner_natural_key` on `(owner_user_id, repo_id,
  pr_number) WHERE installation_id IS NULL` lets two reviewers each own a
  row for the same pull request; artifact natural keys compare NULLS NOT
  DISTINCT so a URL row's Briefs upsert like any other.
- **Two scopes, one seam.** Every store resolves its context into a
  `RowScope` once (`packages/persistence/src/stores/scope.ts`): the
  Installation scope filters on `installation_id`; the owner scope filters
  on a NULL `installation_id` plus a `pull_request` semi-join on
  `owner_user_id`. A query never mixes the two, and a write stamps one.
- **The paste is the only door, and it mints the owner.** `POST` generate
  (`apps/api/src/routes/generate/generate-brief.ts`) reads the pull request
  on the viewer's own token, upserts the row into the viewer's owner scope,
  and enqueues the job with `owner_user_id` and a grant reference
  (`GenerateJobPayload`, `packages/types/src/jobs.ts`), never token material.
  The worker reads on that grant (`apps/worker/src/task/github-port.ts`).
  No webhook reaches a URL row, so the worker's generate run re-enqueues a
  newer head it sees on its own read
  (`apps/worker/src/task/url-box-regeneration.ts`); a live read never queues.
- **Anyone GitHub lets read may open it.** The per-PR access step tries the
  repository's Installation first, then the URL rows instance-wide
  (`resolveUrlBoxOwner`, `packages/persistence/src/stores/url-box.ts`; own
  row first, else the oldest). Per-reviewer state stays apart through the
  Review Session's key. Deleting a URL row is the owner's session-only
  purge; it needs no GitHub call.
- **The Operator's token serves its owner only.** `MERGEBRIEF_URL_BOX_TOKEN`
  is tried after the viewer's token is denied, for reads alone, and only
  when the viewer is the GitHub account that owns it, the path names a pull
  request, and that pull request is in the viewer's own URL rows
  (`apps/api/src/access/operator-token.ts`). Every write runs on the
  viewer's token.

## Consequences

- Operations that need the App's credential or an Installation's stored
  rows declare `requiresInstallation` and answer 404 for a URL row (ADR
  0039's policy fields).
- Audit rows key on the scope the request acted in: an Installation id, or
  a NULL `installation_id` with `source: url` (ADR 0043).
- The Inbox is the one read that spans both scopes: the viewer's
  Installations plus their own URL rows (`packages/persistence/AGENTS.md`).
- Conversation and diff reads on a URL row ride the viewer's binding instead
  of the App's (ADR 0027 as amended).
- The glossary term is **URL**, a **Source** value; "url-box" survives only
  in identifiers.
