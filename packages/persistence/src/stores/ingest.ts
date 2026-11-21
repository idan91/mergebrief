// The transactional ingest boundary, the ONE write path a generation-relevant
// webhook takes: upsert the `pull_request` root, upsert the brief `generation`
// row, enqueue graphile's `generate` job through `graphile_worker.add_job` BY
// NAME on the same transaction (graphile owns its schema; this package never
// imports it). The job key `generate:{pull_request_id}` with `preserve_run_at`
// is a LEADING-edge debounce: the first push fixes `run_at`, later pushes only
// replace the payload head, a locked job gets its key detached and a fresh
// job, and a head a live run holds is neither reset nor re-enqueued.
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { traceStore } from "./trace-store";
import { isHeldOnStatusChecks } from "./unmet-conditions";
import { type AppDatabase, internal } from "../db/handle";
import { brief } from "../schema/brief";
import { checkpoint } from "../schema/checkpoint";
import { delta } from "../schema/delta";
import { generation } from "../schema/generation";
import { pullRequest } from "../schema/pull-request";
import {
  getGenerateJobKey,
  isHopelessFailure,
  projectAwaitingTrigger,
  projectPendingGeneration,
  readCurrentBriefHead,
  releaseAwaitingTrigger,
  releaseHeldHead,
  stampBriefTriggered,
  stampGenerateRequested,
  type GenerationRow,
  type ProjectedGeneration,
} from "./generation";
import {
  buildNextRowVersion,
  upsertPullRequestRow,
  type UpsertExecutor,
} from "./pull-request-upsert";
import {
  approvePullRequestTrigger,
  type PullRequestRow,
  type PullRequestUpsertInput,
} from "./tenant";
import {
  addEntrySyncJob,
  addQueueJob,
  buildJobPayload,
  getRecoveryJobKey,
  readQueueJob,
  type QueueJobState,
} from "./queue";
import { resolveScope, type RowScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import {
  GenerationFailureClasses,
  GenerationFailureClassByCode,
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
  QueueTasks,
  type GenerationStatus,
  type Mutable,
} from "types";
import {
  GenerationKinds,
  JobKeyModes,
  TriggerOnDemandOutcomes,
  type BriefRowId,
  type GrantRowId,
  type PullRequestRowId,
  type RepoId,
  type TriggerOnDemandOutcome,
  type ReviewerId,
  type UncoveredWork,
} from "../types";

const DEFAULT_DEBOUNCE_SECONDS = 60;
/** How far out a Generate or Regenerate click queues the head's job. */
export const TRIGGER_ON_DEMAND_DELAY_SECONDS = 10;
/**
 * How far out a status check queues a held head's re-check. A CI run reports
 * by the dozen, and a waiting job keeps its first `run_at`, so a burst inside
 * this window collapses into one re-check.
 */
export const STATUS_CHECK_RECHECK_DELAY_SECONDS = 45;

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

/** A head a fact event may re-check: held, or pending or failed with a run in flight; `isRecheckOwed` narrows failed further. */
const RECHECKED_STATUSES: ReadonlySet<GenerationStatus> = new Set([
  GenerationStatuses.HELD,
  GenerationStatuses.PENDING,
  GenerationStatuses.FAILED,
]);

/** A row a queued job still has work for; any other row is finished. */
const WAITS_FOR_JOB: ReadonlySet<GenerationStatus> = new Set([
  GenerationStatuses.PENDING,
  GenerationStatuses.AWAITING_TRIGGER,
  GenerationStatuses.HELD,
]);

/**
 * The caller's trust decision gates only an installation row no collaborator
 * has approved yet. A url-box paste is the viewer's own intent and never waits.
 */
function owesTriggerApproval(
  scope: RowScope,
  input: TriggerGenerationInput,
  prRow: PullRequestRow,
): boolean {
  const installationRow = scope.ownerUserId === null;
  const gated = installationRow && input.requiresTriggerApproval === true;
  const owesApproval = gated && prRow.triggerApprovedAt === null;
  return owesApproval;
}

type IngestTransaction = Parameters<
  Parameters<ReturnType<typeof internal>["transaction"]>[0]
>[0];

/**
 * Whether a worker holds the PR's generate job right now. A run over a
 * stored brief never marks the projection, so the queue is the only place
 * that shows it; a second job on a locked key would run beside the live one.
 */
async function isGenerateJobLocked(
  tx: IngestTransaction,
  pullRequestId: PullRequestRowId,
): Promise<boolean> {
  const job = await readQueueJob(tx, getGenerateJobKey(pullRequestId));
  return job?.locked === true;
}

/**
 * Whether a job waits in the queue with no worker on it yet. A job that spent
 * its attempts stays in graphile's table unlocked but never runs again, so it
 * does not count as waiting.
 */
function isJobWaiting(job: QueueJobState | undefined): boolean {
  if (job === undefined) {
    return false;
  }
  return !job.locked && job.hasAttemptsLeft;
}

async function hasQueuedGenerateJob(
  tx: IngestTransaction,
  pullRequestId: PullRequestRowId,
): Promise<boolean> {
  const job = await readQueueJob(tx, getGenerateJobKey(pullRequestId));
  return isJobWaiting(job);
}

/**
 * A failure a graphile retry of the same job may follow. A failure the worker
 * never retries, or a spent claim budget, is final, and a job still locked
 * behind it is only finishing: a fresh job would rerun it or hold it.
 */
function isRetriedFailure(row: GenerationRow): boolean {
  const { errorCode } = row;
  const exhausted = errorCode === GenerationFailureCodes.ATTEMPTS_EXHAUSTED;
  if (errorCode === null || exhausted) {
    return false;
  }
  const failureClass = GenerationFailureClassByCode[errorCode];
  return failureClass === GenerationFailureClasses.TRANSIENT;
}

/**
 * Whether a fact event owes the head a fresh job. A job waiting unlocked
 * re-checks when it runs, whatever its task, and an `add_job` would rewrite a
 * `generate-large` job back to `generate`. Otherwise a held head is owed one,
 * a pending one only while its run is in flight, and a failed one only while
 * a retry of a failure that may still clear is in flight.
 */
function isRecheckOwed(
  job: QueueJobState | undefined,
  row: GenerationRow,
): boolean {
  const { status } = row;
  if (!RECHECKED_STATUSES.has(status)) {
    return false;
  }
  const finalFailure =
    status === GenerationStatuses.FAILED && !isRetriedFailure(row);
  if (finalFailure) {
    return false;
  }
  if (isJobWaiting(job)) {
    return false;
  }

  const recheckOwed =
    status === GenerationStatuses.HELD || job?.locked === true;
  return recheckOwed;
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
  const locked = await lockPullRequestRow(tx, scope, pullRequestId);
  return locked !== undefined;
}

/** `lockPullRequestInScope`, answering the locked row itself. */
async function lockPullRequestRow(
  tx: IngestTransaction,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
): Promise<PullRequestRow | undefined> {
  const rows = await tx
    .select()
    .from(pullRequest)
    .where(and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)))
    .limit(1)
    .for("update");
  return rows[0];
}

/** Which head a wake re-checks and how far out its job runs. */
interface HeadRecheck {
  readonly pullRequestId: PullRequestRowId;
  /** Only while this is the PR's current head; absent wakes whatever is. */
  readonly headSha?: string;
  readonly delaySeconds: number;
  /** A status check's recheck: a held head no run holds wakes only while a `bots` or `ci` item holds it. */
  readonly requiresStatusCheckHold: boolean;
}

/**
 * Queues the job of an open PR whose current head the wake rule names, read
 * under the PR's row lock; with `headSha`, only while that is the current
 * head.
 */
async function recheckLockedHead(
  tx: IngestTransaction,
  scope: RowScope,
  recheck: HeadRecheck,
): Promise<boolean> {
  const { pullRequestId, headSha } = recheck;
  const prRow = await lockPullRequestRow(tx, scope, pullRequestId);
  if (prRow?.state !== PrStates.OPEN) {
    return false;
  }
  const head = await readCurrentBriefHead(tx, scope, pullRequestId);
  if (head === undefined) {
    return false;
  }
  const headMoved = headSha !== undefined && head.row.headSha !== headSha;
  if (headMoved) {
    return false;
  }
  const job = await readQueueJob(tx, getGenerateJobKey(pullRequestId));
  if (!isRecheckOwed(job, head.row)) {
    return false;
  }
  const jobLocked = job?.locked === true;
  const statusCheckCannotMove =
    recheck.requiresStatusCheckHold &&
    !jobLocked &&
    !isHeldOnStatusChecks(head.row.unmetConditions);
  if (statusCheckCannotMove) {
    return false;
  }

  await enqueueGenerateJob(
    tx,
    scope,
    { headSha: head.row.headSha },
    pullRequestId,
    recheck.delaySeconds,
  );
  return true;
}

/**
 * The scope's open PRs in the repository with a brief row at the SHA the wake
 * may name, in id order, the order their row locks are taken in. Unlocked:
 * the wake reads each one again under its lock.
 */
async function listRecheckCandidates(
  tx: IngestTransaction,
  scope: RowScope,
  input: RecheckHeadsAtShaInput,
): Promise<PullRequestRowId[]> {
  const rows = await tx
    .selectDistinct({ id: pullRequest.id })
    .from(pullRequest)
    .innerJoin(generation, eq(generation.pullRequestId, pullRequest.id))
    .where(
      and(
        scope.matchesPullRequest(),
        eq(pullRequest.repoId, input.repoId),
        eq(pullRequest.state, PrStates.OPEN),
        scope.matchesChild(generation.installationId, generation.pullRequestId),
        eq(generation.kind, GenerationKinds.BRIEF),
        eq(generation.headSha, input.headSha),
        inArray(generation.status, [...RECHECKED_STATUSES]),
      ),
    )
    .orderBy(pullRequest.id);
  return rows.map((row) => row.id);
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

/** The head the PR's newest trigger named; `undefined` with no brief row. */
async function readCurrentHeadSha(
  tx: IngestTransaction,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
): Promise<string | undefined> {
  const current = await readCurrentBriefHead(tx, scope, pullRequestId);
  return current?.row.headSha;
}

/**
 * A head with a row and not current is one the PR has left, and so is a head
 * whose review came before the current head's trigger. Any other head with no
 * row keeps the trigger as named: its push may have been lost, and this is the
 * heal.
 */
async function pinLateTriggerToCurrentHead(
  tx: IngestTransaction,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  input: TriggerGenerationInput,
): Promise<TriggerGenerationInput> {
  const current = await readCurrentBriefHead(tx, scope, pullRequestId);
  if (current === undefined || current.row.headSha === input.headSha) {
    return input;
  }
  const pinned = { ...input, headSha: current.row.headSha };
  const { reviewSubmittedAt } = input;
  const predatesCurrent =
    reviewSubmittedAt !== undefined &&
    reviewSubmittedAt < current.row.triggeredAt;
  if (predatesCurrent) {
    return pinned;
  }

  const named = await tx
    .select({ id: generation.id })
    .from(generation)
    .where(
      and(
        scope.matchesChild(generation.installationId, generation.pullRequestId),
        eq(generation.pullRequestId, pullRequestId),
        eq(generation.kind, GenerationKinds.BRIEF),
        eq(generation.headSha, input.headSha),
      ),
    )
    .limit(1);
  return named.length > 0 ? pinned : input;
}

/**
 * Why the current head cannot take a fresh run, or `undefined` when it can:
 * a head waiting for its Trigger approval, one trigger conditions hold, or
 * one that failed in a way a rerun can help. A closed or merged PR has
 * nothing left to generate for. Only a head the projection keeps in flight
 * (a live claim, or the previous release's running row) is refused, as on a
 * push: a dead worker's job stays locked for hours, and a live one that has
 * not claimed yet meets the reset row's fence. A failed head whose brief is
 * stored failed after it, and a fresh run there would claim nothing.
 */
async function findTriggerOnDemandRefusal(
  tx: IngestTransaction,
  scope: RowScope,
  prRow: PullRequestRow,
  head: ProjectedGeneration,
): Promise<TriggerOnDemandOutcome | undefined> {
  if (prRow.state !== PrStates.OPEN) {
    return TriggerOnDemandOutcomes.NOT_REGENERABLE;
  }
  if (head.inFlight) {
    return TriggerOnDemandOutcomes.RUNNING;
  }
  if (head.row.status === GenerationStatuses.AWAITING_TRIGGER) {
    return undefined;
  }
  if (head.row.status === GenerationStatuses.HELD) {
    return undefined;
  }
  const failed = head.row.status === GenerationStatuses.FAILED;
  const regenerable = failed && !isHopelessFailure(head.row.errorCode);
  if (!regenerable) {
    return TriggerOnDemandOutcomes.NOT_REGENERABLE;
  }
  const storedBrief = await findStoredBrief(tx, scope, prRow, head.row.headSha);
  if (storedBrief !== undefined) {
    return TriggerOnDemandOutcomes.NOT_REGENERABLE;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Surface.
// ---------------------------------------------------------------------------

export interface TriggerGenerationInput {
  /** When a review event's review was submitted; absent on any other trigger. */
  readonly reviewSubmittedAt?: Date;
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
   * since every replace re-arms the debounce. A head the projection keeps in
   * flight still gets no job; the live run reads the flip itself.
   */
  readonly refreshRunAt?: boolean;
  /**
   * Work this event names beyond the Brief itself. A stored brief for the
   * base and head pair covers the event and queues nothing, unless work is
   * named here: the Entry comment on a ready flip, the checkpoint delta on a
   * submitted review. The job runs without a projection write.
   */
  readonly uncoveredWork?: UncoveredWork;
  /**
   * The PR's author needs a collaborator's approval before a brief is paid
   * for. Until the PR carries one, a head with no row projects
   * `awaiting-trigger` instead of `pending` and the job is queued as usual; a
   * head with a row keeps it, queued only while it is `pending` or
   * `awaiting-trigger`. The trust decision is the caller's; a stored brief
   * for the pair still covers the event.
   */
  readonly requiresTriggerApproval?: boolean;
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
   * Move the running job to the large pool: a `generate-large` job due now
   * under the PR's generate key, or `recover-generation-large` under the
   * head's recovery key for a recovery run, beside the locked job that holds
   * the key now. An unlocked job already waiting under the key is a newer
   * trigger's or a later claim's and runs anyway, so nothing is queued and
   * the caller stands down; a PR outside the scope queues nothing.
   */
  routeToLargePool(input: RouteToLargePoolInput): Promise<RequeueOutcome>;
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
  /**
   * Queue the head's Entry sync, `delaySeconds` out: a job that renders the
   * Entry comment from the head's generation row, retried with graphile's
   * backoff. One stays pending per head, a later call moving it. Without a
   * head it syncs the PR's current one. An owner scope, a PR outside the
   * scope and, with no head named, a PR with no brief row queue nothing. Throws `RangeError` on a
   * negative or non-finite delay.
   */
  queueEntrySync(input: QueueEntrySyncInput): Promise<RequeueOutcome>;
  /**
   * An approved PR's head still held `awaiting-trigger` goes back to
   * `pending` and its job is queued, as a Generate click would. The approval
   * and the row are read under the pull request's row lock; an unapproved,
   * closed or merged PR, a head no longer held, an owner scope and a PR
   * outside the scope write nothing.
   */
  releaseApprovedHold(input: ReleaseApprovedHoldInput): Promise<RequeueOutcome>;
  /**
   * An open PR whose current head is `held`, or `pending` or `failed` with
   * its job locked by a run that may write a hold before it sees the new
   * facts (a failure only when graphile may retry it: transient, with the
   * claim budget not yet spent), gets that head's job queued, so the worker checks the conditions
   * again; a locked job's key is detached and a fresh job follows it. A job
   * waiting unlocked under the key, whatever its task, is left as it is. Read
   * under the pull request's row lock; any other status, a closed or merged
   * PR, an owner scope and a PR outside the scope queue nothing.
   */
  recheckCurrentHead(input: RecheckCurrentHeadInput): Promise<RequeueOutcome>;
  /**
   * `recheckCurrentHead` for every open PR in the repository whose current
   * head is the SHA, by the same rule, for a status check that names a commit and no
   * PR; a held head wakes only while a `bots` or `ci` item holds it, the only
   * kinds a report can move. Each PR is locked in id order and read again under its lock; a head
   * the PR has pushed past, another repository's or installation's PR and an
   * owner scope queue nothing. The job runs `STATUS_CHECK_RECHECK_DELAY_SECONDS`
   * out, so a CI run's burst of reports collapses into one re-check.
   */
  recheckHeadsAtSha(
    input: RecheckHeadsAtShaInput,
  ): Promise<RecheckHeadsOutcome>;
  /**
   * A pusher's fresh run of the PR's current head: projected `pending` with
   * its claims reset, and the job queued a few seconds out, replacing a
   * waiting one; a locked job gets its key detached, as on a push. A head
   * awaiting its trigger also records the approver's Trigger approval in the
   * same transaction, and is refused when the caller named none; a failed
   * head records none. A closed or merged PR, an in-flight head, any other
   * status, a cannot-help failure, a failed head whose brief is stored, and a
   * PR outside an installation scope write nothing.
   */
  triggerOnDemand(input: TriggerOnDemandInput): Promise<TriggerOnDemandOutcome>;
}

export interface TriggerOnDemandInput {
  readonly pullRequestId: PullRequestRowId;
  /**
   * The pusher recorded as the PR's Trigger approver. Only a caller that may
   * approve names one; without it an awaiting-trigger head is refused.
   */
  readonly approverId?: ReviewerId;
}

export interface RequeueGenerateJobInput {
  readonly pullRequestId: PullRequestRowId;
  readonly headSha: string;
  /** The url-box job's credential reference, as on `TriggerGenerationInput`. */
  readonly grantId?: GrantRowId;
  readonly delaySeconds: number;
}

export interface RouteToLargePoolInput {
  readonly pullRequestId: PullRequestRowId;
  readonly headSha: string;
  /** The url-box job's credential reference, as on `TriggerGenerationInput`. */
  readonly grantId?: GrantRowId;
  /** A recovery job's run moves under the head's recovery key instead of the PR's generate key. */
  readonly recovering: boolean;
}

export interface QueueEntrySyncInput {
  readonly pullRequestId: PullRequestRowId;
  /** Absent syncs the PR's current head. */
  readonly headSha?: string;
  readonly delaySeconds: number;
}

export interface ReleaseApprovedHoldInput {
  readonly pullRequestId: PullRequestRowId;
  readonly headSha: string;
}

export interface RecheckCurrentHeadInput {
  readonly pullRequestId: PullRequestRowId;
}

export interface RecheckHeadsAtShaInput {
  readonly repoId: RepoId;
  readonly headSha: string;
}

export interface RecheckHeadsOutcome {
  /** The PRs whose head at the SHA got a recheck job queued, in id order. */
  readonly rechecked: readonly PullRequestRowId[];
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

        // A review carries a head the PR may have left: it counts for the head
        // the PR is on, or its job would replace that head's and strand it.
        const trigger = namesCurrentHead
          ? input
          : await pinLateTriggerToCurrentHead(tx, scope, prRow.id, input);

        // 1a. A brief for the pair covers the event. Work the brief leaves
        // undone, named by the event or owed to a checkpointed reviewer, still
        // queues a job, with no projection write beyond naming the head as the
        // one last triggered: a run over a stored brief never touches the row.
        const storedBrief = await findStoredBrief(
          tx,
          scope,
          prRow,
          trigger.headSha,
        );
        if (storedBrief !== undefined) {
          if (namesCurrentHead) {
            await stampBriefTriggered(tx, scope, prRow.id, trigger.headSha);
          }
          const owesWork =
            namesUncoveredWork(trigger) ||
            (await owesCheckpointDelta(tx, scope, prRow.id, trigger.headSha));
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

        // 2. Project the brief generation as `pending`, or `awaiting-trigger`
        // while the PR owes an approval. A head the projection keeps in flight
        // (a live claim, or the previous release's running row) is never
        // re-enqueued, refreshRunAt included: under N slots a fresh job for
        // the same head would run beside the live one. The live run re-reads
        // draft state before its ready Entry instead. A gated trigger on a head that
        // already has a row keeps it, and queues a job only while that row
        // still waits for one, so a failed head keeps its failure.
        const value: Mutable<IngestOutcome> = {
          pullRequest: prRow,
          applied: true,
          queued: false,
        };
        if (storedBrief === undefined) {
          const gated = owesTriggerApproval(scope, trigger, prRow);
          const project = gated
            ? projectAwaitingTrigger
            : projectPendingGeneration;
          const projected = await project(tx, scope, {
            pullRequestId: prRow.id,
            kind: GenerationKinds.BRIEF,
            headSha: trigger.headSha,
            baselineSha: null,
          });
          if (namesCurrentHead) {
            await stampBriefTriggered(tx, scope, prRow.id, trigger.headSha);
          }
          value.generation = projected.row;
          if (projected.inFlight) {
            return value;
          }
          const keepsFinishedRow =
            gated && !WAITS_FOR_JOB.has(projected.row.status);
          if (keepsFinishedRow) {
            return value;
          }
        } else if (await isGenerateJobLocked(tx, prRow.id)) {
          return value;
        }

        // 3. Enqueue on the same tx.
        await enqueueGenerateJob(
          tx,
          scope,
          trigger,
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

    async routeToLargePool(input) {
      return db.transaction(async (tx) => {
        const { pullRequestId, headSha, recovering } = input;
        const inScope = await lockPullRequestInScope(tx, scope, pullRequestId);
        if (!inScope) {
          return { queued: false };
        }
        const key = recovering
          ? getRecoveryJobKey(pullRequestId, headSha)
          : getGenerateJobKey(pullRequestId);
        const waiting = await readQueueJob(tx, key);
        if (waiting !== undefined && !waiting.locked) {
          return { queued: false };
        }

        await addQueueJob(tx, {
          identifier: recovering
            ? QueueTasks.RECOVER_GENERATION_LARGE
            : QueueTasks.GENERATE_LARGE,
          payload: buildJobPayload(
            scope,
            input.grantId,
            pullRequestId,
            headSha,
          ),
          key,
          delaySeconds: 0,
          keyMode: JobKeyModes.REPLACE,
        });
        return { queued: true };
      });
    },

    async queueEntrySync(input) {
      assertDelaySeconds("delaySeconds", input.delaySeconds);
      if (scope.ownerUserId !== null) {
        return { queued: false };
      }

      return db.transaction(async (tx) => {
        const { pullRequestId } = input;
        const inScope = await lockPullRequestInScope(tx, scope, pullRequestId);
        if (!inScope) {
          return { queued: false };
        }
        const headSha =
          input.headSha ?? (await readCurrentHeadSha(tx, scope, pullRequestId));
        if (headSha === undefined) {
          return { queued: false };
        }

        await addEntrySyncJob(
          tx,
          scope,
          pullRequestId,
          headSha,
          input.delaySeconds,
        );
        return { queued: true };
      });
    },

    async releaseApprovedHold(input) {
      if (scope.ownerUserId !== null) {
        return { queued: false };
      }

      return db.transaction(async (tx) => {
        const { pullRequestId, headSha } = input;
        const prRow = await lockPullRequestRow(tx, scope, pullRequestId);
        const approvedOpen =
          prRow?.state === PrStates.OPEN && prRow.triggerApprovedAt !== null;
        if (!approvedOpen) {
          return { queued: false };
        }
        const released = await releaseAwaitingTrigger(
          tx,
          scope,
          pullRequestId,
          headSha,
        );
        if (!released) {
          return { queued: false };
        }

        await enqueueGenerateJob(
          tx,
          scope,
          { headSha, refreshRunAt: true },
          pullRequestId,
          TRIGGER_ON_DEMAND_DELAY_SECONDS,
        );
        return { queued: true };
      });
    },

    async recheckCurrentHead(input) {
      if (scope.ownerUserId !== null) {
        return { queued: false };
      }

      return db.transaction(async (tx) => {
        const queued = await recheckLockedHead(tx, scope, {
          pullRequestId: input.pullRequestId,
          delaySeconds: TRIGGER_ON_DEMAND_DELAY_SECONDS,
          requiresStatusCheckHold: false,
        });
        return { queued };
      });
    },

    async recheckHeadsAtSha(input) {
      if (scope.ownerUserId !== null) {
        return { rechecked: [] };
      }

      return db.transaction(async (tx) => {
        const candidates = await listRecheckCandidates(tx, scope, input);
        const rechecked: PullRequestRowId[] = [];
        for (const pullRequestId of candidates) {
          const queued = await recheckLockedHead(tx, scope, {
            pullRequestId,
            headSha: input.headSha,
            delaySeconds: STATUS_CHECK_RECHECK_DELAY_SECONDS,
            requiresStatusCheckHold: true,
          });
          if (queued) {
            rechecked.push(pullRequestId);
          }
        }
        return { rechecked };
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

    async triggerOnDemand(input) {
      if (scope.ownerUserId !== null) {
        return TriggerOnDemandOutcomes.NOT_FOUND;
      }

      return db.transaction(async (tx) => {
        const { pullRequestId } = input;
        const prRow = await lockPullRequestRow(tx, scope, pullRequestId);
        if (prRow === undefined) {
          return TriggerOnDemandOutcomes.NOT_FOUND;
        }

        const head = await readCurrentBriefHead(tx, scope, pullRequestId);
        if (head === undefined) {
          return TriggerOnDemandOutcomes.NOT_REGENERABLE;
        }
        const refusal = await findTriggerOnDemandRefusal(
          tx,
          scope,
          prRow,
          head,
        );
        if (refusal !== undefined) {
          return refusal;
        }
        const awaitingTrigger =
          head.row.status === GenerationStatuses.AWAITING_TRIGGER;
        const { approverId } = input;
        const approverMissing = awaitingTrigger && approverId === undefined;
        if (approverMissing) {
          return TriggerOnDemandOutcomes.NEEDS_APPROVER;
        }

        const { headSha } = head.row;
        if (head.row.status === GenerationStatuses.HELD) {
          const released = await releaseHeldHead(
            tx,
            scope,
            pullRequestId,
            headSha,
          );
          if (!released) {
            return TriggerOnDemandOutcomes.RUNNING;
          }
        } else {
          const projected = await projectPendingGeneration(tx, scope, {
            pullRequestId,
            kind: GenerationKinds.BRIEF,
            headSha,
            baselineSha: null,
          });
          if (projected.inFlight) {
            return TriggerOnDemandOutcomes.RUNNING;
          }
          await stampGenerateRequested(tx, scope, pullRequestId, headSha);
        }
        const approves = awaitingTrigger && approverId !== undefined;
        if (approves) {
          await approvePullRequestTrigger(tx, scope, pullRequestId, approverId);
        }
        await stampBriefTriggered(tx, scope, pullRequestId, headSha);
        await enqueueGenerateJob(
          tx,
          scope,
          { headSha, refreshRunAt: true },
          pullRequestId,
          TRIGGER_ON_DEMAND_DELAY_SECONDS,
        );
        return TriggerOnDemandOutcomes.QUEUED;
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
