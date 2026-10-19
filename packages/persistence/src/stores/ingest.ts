// The transactional ingest boundary, the ONE write path a generation-relevant
// webhook takes: upsert the `pull_request` root, upsert the brief `generation`
// row, enqueue graphile's `generate` job through `graphile_worker.add_job` BY
// NAME on the same transaction (graphile owns its schema; this package never
// imports it). The job key `generate:{pull_request_id}` with `preserve_run_at`
// is a LEADING-edge debounce: the first push fixes `run_at`, later pushes only
// replace the payload head, a locked job gets its key detached and a fresh
// job, and a head a live run holds is neither reset nor re-enqueued.
import { and, eq, isNull, ne } from "drizzle-orm";
import { traceStore } from "./trace-store";
import { type AppDatabase, internal } from "../db/handle";
import { brief } from "../schema/brief";
import { checkpoint } from "../schema/checkpoint";
import { delta } from "../schema/delta";
import { generation } from "../schema/generation";
import { pullRequest } from "../schema/pull-request";
import {
  getGenerateJobKey,
  projectPendingGeneration,
  stampBriefTriggered,
  type GenerationRow,
} from "./generation";
import {
  buildNextRowVersion,
  upsertPullRequestRow,
  type UpsertExecutor,
} from "./pull-request-upsert";
import type { PullRequestRow, PullRequestUpsertInput } from "./tenant";
import {
  addQueueJob,
  buildJobPayload,
  getRecoveryJobKey,
  readQueueJob,
} from "./queue";
import { resolveScope, type RowScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import { GenerationStatuses, PrStates, QueueTasks, type Mutable } from "types";
import {
  GenerationKinds,
  JobKeyModes,
  type BriefRowId,
  type GrantRowId,
  type PullRequestRowId,
  type UncoveredWork,
} from "../types";

const DEFAULT_DEBOUNCE_SECONDS = 60;

/**
 * A head a live read stamped, cleared when this newer event reports another:
 * the stamp no longer says what GitHub holds, and the next due read stamps
 * the head again. A push the read did not see is still caught then, and an
 * older push delivered late cannot write its head over a newer one.
 */
async function clearLiveHeadStamp(
  executor: Pick<ReturnType<typeof internal>, "update">,
  scope: RowScope,
  prRow: PullRequestRow,
  headSha: string,
): Promise<PullRequestRow> {
  const stamped = prRow.githubHeadSha;
  if (stamped === null || stamped === headSha) {
    return prRow;
  }
  const thisRow = and(scope.matchesPullRequest(), eq(pullRequest.id, prRow.id));
  const clear = executor.update(pullRequest).set({
    githubHeadSha: null,
    rowVersion: buildNextRowVersion(),
  });
  const [cleared] = await clear.where(thisRow).returning();
  if (cleared === undefined) {
    return prRow;
  }
  return cleared;
}

/**
 * The stored brief for the row's base and the input's head. A row without a
 * base SHA has no pair to match.
 */
async function findStoredBrief(
  executor: UpsertExecutor,
  scope: RowScope,
  prRow: PullRequestRow,
  headSha: string,
): Promise<BriefRowId | undefined> {
  if (prRow.baseSha === null) {
    return undefined;
  }

  const pullRequestId: PullRequestRowId = prRow.id;
  const rows = await executor
    .select({ id: brief.id })
    .from(brief)
    .where(
      and(
        scope.matchesChild(brief.installationId, brief.pullRequestId),
        eq(brief.pullRequestId, pullRequestId),
        eq(brief.baseSha, prRow.baseSha),
        eq(brief.headSha, headSha),
      ),
    )
    .limit(1);
  return rows[0]?.id;
}

/**
 * Whether the event names work a stored brief leaves undone. The worker
 * decides what is still owed: a ready flip may find its Entry comment
 * current and post nothing, a review its delta already built.
 */
function namesUncoveredWork(input: TriggerGenerationInput): boolean {
  return input.uncoveredWork !== undefined;
}

/**
 * A reviewer checkpointed at another head and no delta reaches this one:
 * a head that comes back (a revert, a reopen) is covered by its brief but
 * still owes that reviewer the delta a fresh run would have built.
 */
async function owesCheckpointDelta(
  executor: UpsertExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  headSha: string,
): Promise<boolean> {
  const rows = await executor
    .select({ id: checkpoint.id })
    .from(checkpoint)
    .leftJoin(
      delta,
      and(
        eq(delta.installationId, checkpoint.installationId),
        eq(delta.pullRequestId, checkpoint.pullRequestId),
        eq(delta.baselineSha, checkpoint.lastSubmittedSha),
        eq(delta.headSha, headSha),
      ),
    )
    .where(
      and(
        scope.matchesChild(checkpoint.installationId, checkpoint.pullRequestId),
        eq(checkpoint.pullRequestId, pullRequestId),
        ne(checkpoint.lastSubmittedSha, headSha),
        isNull(delta.id),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

type IngestTransaction = Parameters<
  Parameters<ReturnType<typeof internal>["transaction"]>[0]
>[0];

/**
 * Whether a worker holds the PR's generate job right now. A run over a
 * stored brief never marks the projection, so the queue is the only place
 * that shows it; a second job on a held key would run beside the live one.
 */
async function isGenerateJobHeld(
  tx: IngestTransaction,
  pullRequestId: PullRequestRowId,
): Promise<boolean> {
  const job = await readQueueJob(tx, getGenerateJobKey(pullRequestId));
  return job?.locked === true;
}

/**
 * Whether a job for the PR waits in the queue with no worker on it yet. A job
 * that spent its attempts stays in graphile's table unlocked but never runs
 * again, so it does not count as waiting.
 */
async function hasQueuedGenerateJob(
  tx: IngestTransaction,
  pullRequestId: PullRequestRowId,
): Promise<boolean> {
  const job = await readQueueJob(tx, getGenerateJobKey(pullRequestId));
  if (job === undefined) {
    return false;
  }
  const waitsForWorker = !job.locked && job.hasAttemptsLeft;
  return waitsForWorker;
}

/**
 * Locks the PR row when the scope holds it. A trigger's upsert takes the same
 * lock, so a queue read after this one sees any job that trigger added.
 */
async function lockPullRequestInScope(
  tx: IngestTransaction,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
): Promise<boolean> {
  const rows = await tx
    .select({ id: pullRequest.id })
    .from(pullRequest)
    .where(and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)))
    .limit(1)
    .for("update");
  return rows.length > 0;
}

/**
 * A negative or non-finite delay would enqueue a job that fires at once or
 * never. Every delay comes from our own code, so a bad one is a defect.
 */
function assertDelaySeconds(name: string, value: number | undefined): void {
  if (value === undefined || (Number.isFinite(value) && value >= 0)) {
    return;
  }
  throw new RangeError(
    `${name} must be a non-negative finite number, got ${value}`,
  );
}

/** Enqueue on the SAME tx via graphile's public SQL function. */
async function enqueueGenerateJob(
  tx: IngestTransaction,
  scope: RowScope,
  input: Pick<TriggerGenerationInput, "headSha" | "grantId" | "refreshRunAt">,
  pullRequestId: PullRequestRowId,
  debounceSeconds: number,
): Promise<void> {
  await addQueueJob(tx, {
    identifier: QueueTasks.GENERATE,
    payload: buildJobPayload(
      scope,
      input.grantId,
      pullRequestId,
      input.headSha,
    ),
    key: getGenerateJobKey(pullRequestId),
    delaySeconds: debounceSeconds,
    keyMode:
      input.refreshRunAt === true
        ? JobKeyModes.REPLACE
        : JobKeyModes.PRESERVE_RUN_AT,
  });
}

// ---------------------------------------------------------------------------
// Surface.
// ---------------------------------------------------------------------------

export interface TriggerGenerationInput {
  /** The PR the event describes; a trigger carries `state: open`. */
  readonly pullRequest: PullRequestUpsertInput;
  /** The head SHA the pending brief generation targets. */
  readonly headSha: string;
  /** Trailing-debounce window; defaults to 60s. */
  readonly debounceSeconds?: number;
  /**
   * Trailing-debounce window applied INSTEAD of `debounceSeconds` when a prior
   * brief generation for this PR has SUCCEEDED (push-storm damping). The
   * condition is deliberately "a brief exists to look at":
   * pending/failed/superseded priors don't damp. Policy is the caller's; this
   * store owns only the transactional prior-success check.
   */
  readonly regenerationDebounceSeconds?: number;
  /**
   * The url-box job's credential REFERENCE, REQUIRED under an owner scope
   * (the worker resolves and decrypts it), forbidden under an installation
   * scope. Must come from the SAME authenticated session as the owner id:
   * the grant row carries no owner column, so this binding is the door's to
   * uphold.
   */
  readonly grantId?: GrantRowId;
  /**
   * True ONLY for a `reopened` event, which deliberately transitions a
   * closed/merged PR back to open. Every other trigger (`opened`,
   * `synchronize`, `ready_for_review`, `review_requested`, a submitted review)
   * merely IMPLIES the PR is open: if the stored row is already terminal (a
   * stale redelivery, or a review on a since-closed PR) the upsert must NOT
   * resurrect it. Defaults to false (preserve a terminal lifecycle).
   */
  readonly reopen?: boolean;
  /**
   * Replace a pending job's `run_at` with this trigger's window instead of
   * keeping the first push's. The `ready_for_review` flip sets it so a
   * draft-damped job is pulled in to the short window; nothing else should,
   * since every replace re-arms the debounce. A held head still gets no
   * job; the live run reads the flip itself.
   */
  readonly refreshRunAt?: boolean;
  /**
   * Work this event names beyond the Brief itself. A stored brief for the
   * base and head pair covers the event and queues nothing, unless work is
   * named here: the Entry comment on a ready flip, the checkpoint delta on a
   * submitted review. The job runs without a projection write.
   */
  readonly uncoveredWork?: UncoveredWork;
}

export interface IngestOutcome {
  readonly pullRequest: PullRequestRow;
  /**
   * False when the event was older than the stored row's `github_updated_at`:
   * the row, the projection and the queue were left as they were.
   */
  readonly applied: boolean;
  /** True when this call added or replaced the PR's `generate` job. */
  readonly queued: boolean;
  /**
   * Absent when the trigger landed on a PR whose terminal lifecycle was
   * preserved, when the event was skipped or when a stored brief covers it:
   * nothing is projected and no job is enqueued. Present with status
   * `running` when a live run holds the head: the row was kept and no job
   * added.
   */
  readonly generation?: GenerationRow;
  /** The stored brief that covers this event; no job was queued for it. */
  readonly coveredBy?: BriefRowId;
}

export interface IngestRoutines {
  readonly ctx: ScopeContext;
  /**
   * Atomically upsert the PR row, project the brief generation as `pending`,
   * and enqueue/replace the debounced `generate` job. See the module header
   * for the idempotency contract.
   */
  /** Throws `RangeError` on a negative or non-finite debounce. */
  triggerGeneration(input: TriggerGenerationInput): Promise<IngestOutcome>;
  /**
   * Persist PR state fields through the same terminal-preserving upsert as
   * `triggerGeneration` WITHOUT touching the projection or enqueueing work,
   * because re-triggering the worker's skip path is not a no-op (Entry-comment
   * ping, compare-diff spend, phantom `pending`). Terminal lifecycles are kept
   * unless `reopen` is set: a `reopened` delivery where policy suppresses the
   * enqueue would otherwise wedge the row closed forever.
   */
  recordState(
    input: PullRequestUpsertInput,
    options?: RecordStateOptions,
  ): Promise<IngestOutcome>;
  /**
   * Queue the PR's `generate` job again, `delaySeconds` out, beside the locked
   * job running now. An unlocked job already queued for the key runs anyway
   * and keeps its payload and `run_at`; a PR outside the scope queues nothing.
   * Throws `RangeError` on a negative or non-finite delay.
   */
  requeueGenerateJob(input: RequeueGenerateJobInput): Promise<RequeueOutcome>;
  /**
   * Queue the head's recovery job, `delaySeconds` out, with the `generate`
   * payload. One stays pending per head: a later call moves its `run_at`, and
   * one locked by a running recovery gets a fresh job beside it. A PR outside
   * the scope queues nothing. Throws `RangeError` on a negative or non-finite
   * delay.
   */
  scheduleClaimRecovery(
    input: RequeueGenerateJobInput,
  ): Promise<RequeueOutcome>;
}

export interface RequeueGenerateJobInput {
  readonly pullRequestId: PullRequestRowId;
  readonly headSha: string;
  /** The url-box job's credential reference, as on `TriggerGenerationInput`. */
  readonly grantId?: GrantRowId;
  readonly delaySeconds: number;
}

export interface RequeueOutcome {
  readonly queued: boolean;
}

export interface RecordStateOptions {
  readonly reopen?: boolean;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/** Build the scope-bound ingest boundary over the opaque handle. */
export function createIngestRoutines(
  handle: AppDatabase,
  ctx: ScopeContext,
): IngestRoutines {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  return traceStore("ingest", {
    ctx,

    async triggerGeneration(input) {
      const debounceSeconds = input.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS;
      assertDelaySeconds("debounceSeconds", debounceSeconds);
      assertDelaySeconds(
        "regenerationDebounceSeconds",
        input.regenerationDebounceSeconds,
      );

      return db.transaction(async (tx) => {
        // 1. A stale trigger (redelivery, review on a closed PR) writes
        // `state: open` too and must not resurrect a closed/merged PR: on
        // conflict the stored terminal lifecycle wins unless `reopened`. The
        // url-box world never preserves: its state comes from a LIVE GitHub
        // read, and briefing a merged PR is that door's primary use.
        const preserveTerminal =
          scope.ownerUserId === null && input.reopen !== true;
        const upserted = await upsertPullRequestRow(
          tx,
          scope,
          input.pullRequest,
          preserveTerminal,
        );
        if (!upserted.applied) {
          return { pullRequest: upserted.row, applied: false, queued: false };
        }
        // Only an event the updated_at guard ordered may clear the head: a
        // review event carries no timestamp, so a late one says nothing new.
        // The same holds for naming the current push: an ordered event or a
        // live read names it, a review may carry a head the PR has left.
        const ordered = input.pullRequest.githubUpdatedAt !== undefined;
        const namesCurrentHead =
          ordered || input.pullRequest.liveRead !== undefined;
        let prRow = upserted.row;
        if (ordered) {
          prRow = await clearLiveHeadStamp(tx, scope, prRow, input.headSha);
        }

        // Terminal preserved → the trigger was stale. Stop here: projecting a
        // `pending` generation row and scheduling the job for a closed/merged PR
        // would leave a forever-pending row and dead work (there is nothing to
        // generate for). The PR upsert above still refreshed repo_slug.
        if (
          preserveTerminal &&
          (prRow.state === PrStates.CLOSED || prRow.state === PrStates.MERGED)
        ) {
          return { pullRequest: prRow, applied: true, queued: false };
        }

        // 1a. A brief for the pair covers the event. Work the brief leaves
        // undone, named by the event or owed to a checkpointed reviewer, still
        // queues a job, with no projection write beyond naming the head as the
        // one last triggered: a run over a stored brief never touches the row.
        const storedBrief = await findStoredBrief(
          tx,
          scope,
          prRow,
          input.headSha,
        );
        if (storedBrief !== undefined) {
          if (namesCurrentHead) {
            await stampBriefTriggered(tx, scope, prRow.id, input.headSha);
          }
          const owesWork =
            namesUncoveredWork(input) ||
            (await owesCheckpointDelta(tx, scope, prRow.id, input.headSha));
          if (!owesWork) {
            return {
              pullRequest: prRow,
              applied: true,
              queued: false,
              coveredBy: storedBrief,
            };
          }
        }

        // 1b. The regeneration window applies only when a prior brief for this
        // PR SUCCEEDED, checked on THIS tx so the read and the enqueue can't
        // interleave with another trigger's projection write. Must run before
        // step 2, which upserts the current head's own (pending) row.
        let effectiveDebounceSeconds = debounceSeconds;
        if (input.regenerationDebounceSeconds !== undefined) {
          const prior = await tx
            .select({ id: generation.id })
            .from(generation)
            .where(
              and(
                scope.matchesChild(
                  generation.installationId,
                  generation.pullRequestId,
                ),
                eq(generation.pullRequestId, prRow.id),
                eq(generation.kind, GenerationKinds.BRIEF),
                eq(generation.status, GenerationStatuses.SUCCEEDED),
              ),
            )
            .limit(1);
          if (prior.length > 0) {
            effectiveDebounceSeconds = input.regenerationDebounceSeconds;
          }
        }

        // 2. Project the brief generation as `pending`. A held head is
        // never re-enqueued, refreshRunAt included: under N slots a fresh job
        // for the same head would run beside the live one. The live run
        // re-reads draft state before its ready Entry instead.
        const value: Mutable<IngestOutcome> = {
          pullRequest: prRow,
          applied: true,
          queued: false,
        };
        if (storedBrief === undefined) {
          const projected = await projectPendingGeneration(tx, scope, {
            pullRequestId: prRow.id,
            kind: GenerationKinds.BRIEF,
            headSha: input.headSha,
            baselineSha: null,
          });
          if (namesCurrentHead) {
            await stampBriefTriggered(tx, scope, prRow.id, input.headSha);
          }
          value.generation = projected.row;
          if (projected.held) {
            return value;
          }
        } else if (await isGenerateJobHeld(tx, prRow.id)) {
          return value;
        }

        // 3. Enqueue on the same tx.
        await enqueueGenerateJob(
          tx,
          scope,
          input,
          prRow.id,
          effectiveDebounceSeconds,
        );
        value.queued = true;
        return value;
      });
    },

    async requeueGenerateJob(input) {
      assertDelaySeconds("delaySeconds", input.delaySeconds);

      return db.transaction(async (tx) => {
        const { pullRequestId } = input;
        const inScope = await lockPullRequestInScope(tx, scope, pullRequestId);
        const alreadyQueued =
          inScope && (await hasQueuedGenerateJob(tx, pullRequestId));
        if (!inScope || alreadyQueued) {
          return { queued: false };
        }

        await enqueueGenerateJob(
          tx,
          scope,
          input,
          pullRequestId,
          input.delaySeconds,
        );
        return { queued: true };
      });
    },

    async scheduleClaimRecovery(input) {
      assertDelaySeconds("delaySeconds", input.delaySeconds);

      return db.transaction(async (tx) => {
        const { pullRequestId, headSha } = input;
        const inScope = await lockPullRequestInScope(tx, scope, pullRequestId);
        if (!inScope) {
          return { queued: false };
        }

        await addQueueJob(tx, {
          identifier: QueueTasks.RECOVER_GENERATION,
          payload: buildJobPayload(
            scope,
            input.grantId,
            pullRequestId,
            headSha,
          ),
          key: getRecoveryJobKey(pullRequestId, headSha),
          delaySeconds: input.delaySeconds,
          keyMode: JobKeyModes.REPLACE,
        });
        return { queued: true };
      });
    },

    async recordState(input, options) {
      // One statement, atomic on its own, no tx needed. Terminal-preserving
      // unless the caller explicitly marks a reopen (see the interface doc).
      const upserted = await upsertPullRequestRow(
        db,
        scope,
        input,
        options?.reopen !== true,
      );
      return {
        pullRequest: upserted.row,
        applied: upserted.applied,
        queued: false,
      };
    },
  });
}
