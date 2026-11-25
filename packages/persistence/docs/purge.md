# Sweeps and retention

## Retention (`src/stores/purge.ts`)

- `sweepAuditLog`: the audit log's only removal, instance-wide, unset by default, refusing any window under the 30-day floor.
- `sweepClosedPullRequests`: pull request retention, the instance config's `retention.pullRequestDays`, unset by default, one-day floor. It reads only `pull_request.closed_at`: closing a PR arms nothing, so a row closed before the setting existed is swept like any other. It erases every row closed or merged before the operator's window, both scope worlds, batched 500 per transaction with one `delete` audit entry per installation or owner each batch erased from.

## Credentials

- `sweepExpiredSessions`: session expiry, batched 500 per transaction.
- `sweepDeadCredentials`: a grant a dead token still holds once no session or live token uses it, by the same rule as `deleteOrphanedGrants`, and a grant over a day old that no row references, then every token revoked or expired over 30 days ago, batched 500 per transaction.
- Both credential sweeps hand each committed batch's orphaned grants to the caller's `OrphanedGrantSink`, so the worker revokes them at GitHub even when a later batch fails.
- `deleteUserCredentials` writes one `revoke-app-authorization` audit row with the counts.

## Other sweeps

- `sweepWebhookDeliveries`: every delivery past the 72-hour window, one statement.
- `sweepStaleGenerationParts`: every generation part span whose newest part is over a week old, unless a live claim holds its head, one statement.
