# Ingest, condition stamps and the queue

## `stores/ingest.ts`

The transactional webhook→upsert→enqueue boundary.

- A trigger with no GitHub time, such as a review, naming a head that has a row and is not current counts for the current head. Naming a head with no row it keeps, since that push may have been lost, unless the review came before the current head's trigger.
- `requeueGenerateJob`: the worker's re-enqueue of the job a live claim turned away.
- `routeToLargePool`: moves a running job to the large pool's task under the same key (`generate-large`, or `recover-generation-large` for a recovery run), and stands down when an unlocked job already waits there.
- `scheduleClaimRecovery`: moves a head's `recover-generation` job past a live lease.
- `queueEntrySync`: the head's keyed `sync-entry` job (installation scope only, `ENTRY_SYNC_MAX_ATTEMPTS`).
- `recheckHeadsAtSha`: a status check's wake of every open PR in one repository whose current head at a SHA is held on a `bots` or `ci` item, or held, pending, or failed in a way graphile retries (transient, claims not spent), with its job locked by a run in flight (that run may end held on a check this report settles). It leaves a job that waits unlocked under the key as it is. Installation scope only; the PRs lock in id order and each is read again under its lock. A pending head's locked job gets a fresh job beside it, a waiting one keeps its `run_at`. Its job runs `STATUS_CHECK_RECHECK_DELAY_SECONDS` out, so a CI run's burst of reports collapses into one re-check.
- `triggerOnDemand`: a pusher's fresh run of an open PR's current head that failed in a way a rerun can help, with no stored brief, or that awaits its trigger with an approver named (claims reset, job replaced; an awaiting-trigger head also records the Trigger approval), or that trigger conditions hold (released to `pending`). Every head it queues is stamped `generate_requested_at`, so every run of that head skips the conditions. Installation scope only.
- `turnOnGenerateEveryPush`: stamps the PR's `generate_every_push_*` pair under its row lock and releases an open PR's held current head the same way (installation scope only). Turning it off is the tenant repository's plain row write.

## `stores/condition-stamps.ts`

Reads the PR row's sticky trigger-condition stamps, null as absent (`readConditionStamps`): `review_requested_met_at`, and `paths_met_at` CHECK-paired with `paths_met_digest`, the digest of the globs that matched. The tenant repository writes them: `stampReviewRequestedMet` only over a null stamp, `stampPathsMet` only over another digest, both scope-fenced through the guarded row write and returning the row, written or as it was.

## `stores/queue.ts`

Holds every `graphile_worker.add_job` call this package makes, the job payload builder, and `readQueueJob`, the one read of graphile's job table. Ingest and `claimRun` (which queues the head's recovery job in the claim's transaction) both go through it.
