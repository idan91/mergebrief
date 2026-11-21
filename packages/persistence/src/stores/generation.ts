// The `generation` status-projection write helpers: a mutable CQRS mirror of a
// worker job, never a queue or a domain entity. graphile-worker deletes
// succeeded jobs, so the web tier polls this; retries live in graphile. A run
// claims the row (`run_id` under a lease the database clock judges); each
// claimed or paid run leaves a `generation_attempt` row the daily cap sums.
// The natural key `(installation_id, pull_request_id, kind, head_sha,
// baseline_sha)` is NULLS NOT DISTINCT, because `baseline_sha` is null for
// briefs and every brief upsert would otherwise insert a second row.
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { generation } from "../schema/generation";
import { generationAttempt } from "../schema/generation-attempt";
import { pullRequest } from "../schema/pull-request";
import { resolveScope, ScopeViolationError, type RowScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import {
  addEntrySyncJob,
  addQueueJob,
  buildJobPayload,
  getRecoveryJobKey,
  MAX_GENERATION_ATTEMPTS,
  readQueueJob,
} from "./queue";
import { sanitizeErrorDetail } from "logging";
import { traceStore } from "./trace-store";
import {
  truncateUnmetConditions,
  UnmetConditionsSchema,
} from "./unmet-conditions";
import {
  ChargeOutcomes,
  ClaimEnds,
  ClaimOutcomes,
  GenerationKinds,
  JobKeyModes,
  type ClaimEnd,
  type DatabaseTimestamp,
  isDatabaseTimestamp,
  type GenerationFailure,
  type GrantRowId,
  type PullRequestRowId,
} from "../types";
import {
  GenerationFailureClassByCode,
  GenerationFailureClasses,
  GenerationFailureCodes,
  GenerationStatuses,
  QueueTasks,
  TakeoverJobStates,
  type GenerationFailureCode,
  type GenerationPhase,
  type GenerationStatus,
  type GenerationUnitsParams,
  type Mutable,
  type Result,
  type ValueOf,
  type UnmetCondition,
} from "types";

export type GenerationRow = typeof generation.$inferSelect;

/** Where the PR's queued `generate` job stands, judged by the database clock. */
export interface GenerateJobTiming {
  readonly startsLater: boolean;
  readonly locked: boolean;
  /** False once graphile spent the job's attempts: it stays queued and never runs. */
  readonly hasAttemptsLeft: boolean;
}

/** The newest brief-kind row of a PR, and whether its head spent the claim limit. */
export interface BriefClaims {
  readonly generation: GenerationRow;
  /**
   * `claimRun` would refuse the head as `exhausted`: not succeeded, no live
   * lease, and `MAX_GENERATION_ATTEMPTS` claims since the last trigger.
   */
  readonly exhausted: boolean;
}

export interface ScheduledTakeoverJob {
  readonly state: typeof TakeoverJobStates.SCHEDULED;
  readonly runsAt: Date;
}

export interface RunningTakeoverJob {
  readonly state: typeof TakeoverJobStates.RUNNING;
}

export interface SpentTakeoverJob {
  readonly state: typeof TakeoverJobStates.SPENT;
}

/** The head's recovery job, as the Operator reads it. */
export type TakeoverJob =
  | ScheduledTakeoverJob
  | RunningTakeoverJob
  | SpentTakeoverJob;

/** The graphile job key: one queued `generate` job per PR. */
export function getGenerateJobKey(pullRequestId: PullRequestRowId): string {
  return `${QueueTasks.GENERATE}:${pullRequestId}`;
}

/** The statements a store op runs on one transaction, or the plain handle. */
type GenerationExecutor = Pick<
  AppDrizzle,
  "select" | "update" | "insert" | "execute"
>;

type GenerationSet = PgUpdateSetSource<typeof generation>;

interface TransitionOptions {
  /** Narrows the write; a row the guard refuses is `claim-lost`, as a missing row is. */
  readonly guard?: SQL;
  readonly executor?: GenerationExecutor;
  /** `updated_at` orders the latest brief and bounds the stale sweep; a heartbeat must not move it. */
  readonly keepUpdatedAt?: boolean;
}

/** The day's cap window a started run is counted in. */
interface CapWindow {
  /** Absent skips the count and the lock. */
  readonly cap?: number;
  readonly from: Date;
  readonly to: Date;
}

export interface ClaimRunInput extends CapWindow {
  readonly target: GenerationTarget;
  readonly phase?: GenerationPhase;
  readonly leaseMs: number;
  /** Queue the head's recovery job in the claim's transaction. */
  readonly recovery?: RecoveryJobInput;
  /** The run stands on the pair's stored brief: an exhausted or capped claim settles the row. */
  readonly storedBrief?: StoredBriefSettle;
  /** Queue the head's Entry sync in the claim's transaction, with any end but a left row or a capped claim's kept failure. */
  readonly entrySync?: EntrySyncJobInput;
}

export interface RecoveryJobInput {
  /** After the lease, by the same database clock. */
  readonly delaySeconds: number;
  /** The url-box job's credential reference, as the claiming job carries it. */
  readonly grantId?: GrantRowId;
}

export interface StoredBriefSettle {
  /** Only a row last written at or before it settles, as `settleStoredBrief` fences. */
  readonly pickedUpAt: DatabaseTimestamp;
}

export interface EntrySyncJobInput {
  readonly delaySeconds: number;
}

export interface ChargeRunInput extends CapWindow {
  readonly target: GenerationTarget;
}

/** More cap units for a run that already holds its attempt row. */
export interface ClaimUnitsInput extends CapWindow {
  readonly runId: string;
  /** A positive integer. */
  readonly units: number;
}

export type ClaimUnitsOutcome =
  | { readonly kind: typeof ChargeOutcomes.CHARGED }
  | {
      readonly kind: typeof ChargeOutcomes.CAPPED;
      readonly needed: number;
      /** What the day's cap still allows, zero once it is spent. */
      readonly left: number;
      readonly cap: number;
    };

/** One run's attempt row, as the PR meta reports its progress. */
export interface RunAttempt {
  /** When the attempt was recorded, never the cap's day key, which a claim after midnight moves. */
  readonly recordedAt: Date;
  /** The claim's unit plus every detail call the run claimed. */
  readonly units: number;
  /** Detail parts in, the ones an earlier attempt stored included once the plan is recorded. */
  readonly partsDone: number;
  /** The grouping's planned detail calls; null until `recordPartsPlanned`. */
  readonly partsTotal: number | null;
}

/** A multi-call run's plan as the grouping call set it: every detail call, and how many were already stored. */
export interface PartsPlan {
  readonly total: number;
  readonly done: number;
}

/** The instance's spend over one day, in cap units. */
export interface SpendBreakdown {
  readonly startedUnits: number;
  /** Runs that paid for more than their claim's single unit. */
  readonly largeRuns: { readonly runs: number; readonly units: number };
}

export type ChargeRunOutcome =
  | { readonly kind: typeof ChargeOutcomes.CHARGED; readonly runId: string }
  | {
      readonly kind: typeof ChargeOutcomes.CAPPED;
      readonly startedRuns: number;
    };

/** The row's claim as the database clock judges it. */
export interface GenerationClaim {
  /** A run id is set, live or lapsed. */
  readonly claimed: boolean;
  readonly leaseLive: boolean;
  /** Zero once lapsed or unset. */
  readonly leaseRemainingMs: number;
  /** A takeover handed the row back for the head's recovery job to rerun. */
  readonly awaitsRecovery: boolean;
}

export type ClaimRunOutcome =
  | {
      readonly kind: typeof ClaimOutcomes.CLAIMED;
      readonly runId: string;
      /** The row's first enqueue, the queue-wait fallback for a job-less run. */
      readonly createdAt: Date;
      /** Claims since a trigger projected the row, this one included. */
      readonly claims: number;
    }
  | {
      readonly kind: typeof ClaimOutcomes.RUNNING;
      /** Until the holder's lease lapses, by the database clock. */
      readonly leaseRemainingMs: number;
    }
  | CappedClaim
  | { readonly kind: typeof ClaimOutcomes.FINISHED }
  | { readonly kind: typeof ClaimOutcomes.AWAITING_TRIGGER }
  | { readonly kind: typeof ClaimOutcomes.HOPELESS }
  | ExhaustedClaim;

/** The row's end a refused claim wrote under the row lock, so no trigger lands between the refusal and the end. */
interface RefusedClaimEnd {
  readonly end: ClaimEnd;
  /** The failure the row ends on; absent unless it ends `failed`. */
  readonly errorCode?: GenerationFailureCode;
}

export interface CappedClaim extends RefusedClaimEnd {
  readonly kind: typeof ClaimOutcomes.CAPPED;
  readonly startedRuns: number;
}

export interface ExhaustedClaim extends RefusedClaimEnd {
  readonly kind: typeof ClaimOutcomes.EXHAUSTED;
  readonly claims: number;
}

/** How a claimed run ends. */
export type RunOutcome =
  | { readonly status: typeof GenerationStatuses.SUCCEEDED }
  | { readonly status: typeof GenerationStatuses.SUPERSEDED }
  | {
      readonly status: typeof GenerationStatuses.FAILED;
      readonly failure: GenerationFailure;
      /** A takeover's failure the head's recovery job retries. */
      readonly awaitsRecovery?: boolean;
    }
  | {
      /** A large run `claimUnits` refused: terminal, not a failure. */
      readonly status: typeof GenerationStatuses.CAPPED;
      readonly units: GenerationUnitsParams;
    };

interface ReleaseClaimOptions {
  /** A takeover's release: the head's recovery job reruns the row. */
  readonly awaitsRecovery?: boolean;
}

export interface ProjectedGeneration {
  readonly row: GenerationRow;
  /** The head is in flight, so the projection left every column as stored. */
  readonly inFlight: boolean;
}

// ---------------------------------------------------------------------------
// Errors: expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const GenerationErrorCodes = {
  /** The row is claimed by another run, by none when a holder was named, or is gone. */
  CLAIM_LOST: "claim-lost",
  /** The row is `awaiting-trigger` or `succeeded`, which no unclaimed mark moves. */
  STATUS_KEPT: "status-kept",
  /** A collaborator approved the pull request's runs, so its head is not held. */
  TRIGGER_APPROVED: "trigger-approved",
} as const;
export type GenerationErrorCode = ValueOf<typeof GenerationErrorCodes>;

export interface GenerationError {
  readonly code: GenerationErrorCode;
  readonly message: string;
}

function fail(
  code: GenerationErrorCode,
  message: string,
): Result<never, GenerationError> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// The projection natural key (minus the ctx-supplied installation_id).
// ---------------------------------------------------------------------------

interface BaseGenerationTarget {
  readonly pullRequestId: PullRequestRowId;
  readonly headSha: string;
}

/** A Brief spans the whole PR, so no lower-bound SHA in the projection key. */
interface BriefGenerationTarget extends BaseGenerationTarget {
  readonly kind: typeof GenerationKinds.BRIEF;
  readonly baselineSha: null;
}

/**
 * Span-keyed kinds carry their lower bound: the reviewer's checkpoint SHA
 * for `delta`, the prior briefed head for `revision-narrative`, mirroring
 * each artifact's own natural key (`delta.baseline_sha`,
 * `revision_narrative.prev_head_sha`), so two narratives for the same head
 * but different prevHeads project as distinct rows, exactly like their
 * artifacts.
 */
interface SpanGenerationTarget extends BaseGenerationTarget {
  readonly kind:
    | typeof GenerationKinds.DELTA
    | typeof GenerationKinds.REVISION_NARRATIVE;
  readonly baselineSha: string;
}

export type GenerationTarget = BriefGenerationTarget | SpanGenerationTarget;

// ---------------------------------------------------------------------------
// Surface.
// ---------------------------------------------------------------------------

export interface GenerationProjection {
  readonly ctx: ScopeContext;
  /**
   * Project a job as `pending` through `projectPendingGeneration`, the one
   * projection SQL ingest shares. A parent PR outside ctx's scope throws
   * `ScopeViolationError`.
   */
  upsertPending(target: GenerationTarget): Promise<GenerationRow>;
  /**
   * Reflect `superseded`, a terminal mid-call abort because the PR head
   * advanced. An abort is NOT a failure: it leaves `attempts`
   * untouched (unlike a re-queue) and clears `phase` + error columns (like
   * a finished run), so a superseded job never consumes a retry. Like every
   * unclaimed transition it writes only a row no live lease holds, and
   * otherwise returns `claim-lost`; like every unclaimed mark it leaves an
   * `awaiting-trigger` or `succeeded` row, returning `status-kept`.
   */
  markSuperseded(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `capped`, the terminal skip the instance's daily generation cap
   * produces. Like `markSuperseded` this is NOT a failure:
   * `attempts` is untouched and `phase` + error columns are cleared, so a capped run
   * consumes no retry and shows no error text.
   */
  markCapped(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `awaiting-trigger`, the terminal hold a PR waits in until a
   * collaborator approves its runs. Not a failure: `attempts` is untouched
   * and `phase` + error columns are cleared, like `markCapped`. It holds the
   * pull request's row lock, as an approval does, and reads the approval
   * under it: an approved PR answers `trigger-approved`, a `succeeded` row
   * `status-kept`, a row a live lease holds `claim-lost`.
   */
  markAwaitingTrigger(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `held`: a trigger condition is unmet, `unmetConditions` names
   * every one. Moves only a `pending`, `held` or `failed` row (a retry starts
   * from `failed`) no live lease holds and no Generate click stamped, with a
   * fresh claim budget, under the pull request's row lock a click also
   * takes, so a click either lands first and wins or releases the hold after
   * it. A stamped or kept-status row answers `status-kept`, any other refused
   * row `claim-lost`. Not a failure: `attempts` is untouched. A list or name
   * past the stored bounds is cut, never refused.
   */
  markHeld(
    target: GenerationTarget,
    unmetConditions: readonly UnmetCondition[],
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `failed` with a typed failure, on a row no live lease holds and
   * no unclaimed mark keeps, as `markSuperseded` does. Any `detail` param is sanitized HERE (`sanitizeErrorDetail`: first line, URLs
   * redacted, 300-char cap), so callers cannot store an unsanitized reason.
   */
  markFailed(
    target: GenerationTarget,
    failure: GenerationFailure,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * The holder attaches the repo-config per-file outcome table, written right
   * after acquisition, BEFORE generation, so failed and superseded
   * runs still carry `invalid`/`over-budget`/`fetch-failed` outcomes. A
   * re-queue clears it (the fresh attempt re-acquires).
   */
  recordRepoConfig(
    target: GenerationTarget,
    runId: string,
    repoConfig: string,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** Tenant-scoped read of the projection row; absence is `undefined`. */
  get(target: GenerationTarget): Promise<GenerationRow | undefined>;
  /**
   * The daily spend cap's counter for the WHOLE instance: the sum of `units`
   * over `generation_attempt` rows started in the half-open window
   * `[from, to)`. A claim adds one unit and every `claimUnits` adds its own,
   * graphile retries included, kept whatever the projection row later
   * becomes, unless `refundRun` gives back the units of a run that made no
   * model call. Summed ACROSS repos, tenants and scope worlds: the operator
   * pays one bill whichever door spends it.
   */
  countStartedRuns(input: {
    readonly from: Date;
    readonly to: Date;
  }): Promise<number>;
  /**
   * Claim the row in one transaction that reads it `FOR UPDATE`; with `cap`
   * set, under the instance advisory lock, so the cap is exact across slots
   * and processes (a ceiling, not fair share). `finished` on a succeeded row,
   * `running` under a live lease; `exhausted` after `MAX_GENERATION_ATTEMPTS`
   * claims since a trigger and `capped` at the cap write the row's end under
   * the same lock, so a trigger lands wholly before or after it (`ClaimEnds`);
   * otherwise a run id, a lease of `leaseMs`, `running`, one more claim, one
   * attempt row and, with `recovery`, the head's recovery job. A gone row is `claim-lost`.
   */
  claimRun(
    input: ClaimRunInput,
  ): Promise<Result<ClaimRunOutcome, GenerationError>>;
  /**
   * Charge a paid run that takes no claim (one over a stored brief) to the
   * day's cap: the count and one attempt row in one transaction, under the
   * same lock as `claimRun`. The row is left as found; one that is gone is
   * `claim-lost`.
   */
  chargeRun(
    input: ChargeRunInput,
  ): Promise<Result<ChargeRunOutcome, GenerationError>>;
  /**
   * Add `units` to the run's attempt row under the same instance lock as
   * `claimRun`, so the day's total never passes `cap`. A row started before
   * the window moves to its start with every unit it holds, and those come
   * out of what the window has left. At the cap nothing is written and the
   * answer names the units needed, the units left and the cap. A run id no
   * attempt row in the scope holds is `claim-lost`.
   */
  claimUnits(
    input: ClaimUnitsInput,
  ): Promise<Result<ClaimUnitsOutcome, GenerationError>>;
  /**
   * Give back every unit of a run that finished without a model call: its
   * attempt row stays on the ledger at 0 units, so the day's count and the
   * spend read drop by what it held. Only lowers the count, so it needs no
   * cap lock. A run id no attempt row in the scope holds is `claim-lost`.
   */
  refundRun(runId: string): Promise<Result<void, GenerationError>>;
  /** One more finished part on the run's attempt row; answers the new count. */
  recordPartDone(runId: string): Promise<Result<number, GenerationError>>;
  /** The run's planned detail calls and the stored ones it starts from, on its attempt row; `claim-lost` for an unknown run id, `RangeError` for a plan that is not whole parts (a caller's bug). */
  recordPartsPlanned(
    runId: string,
    plan: PartsPlan,
  ): Promise<Result<void, GenerationError>>;
  /** The run's attempt row in the scope; `undefined` when none holds the id. */
  readRunAttempt(runId: string): Promise<RunAttempt | undefined>;
  /** The row's claim, judged by the database clock; `undefined` when absent. */
  readClaim(target: GenerationTarget): Promise<GenerationClaim | undefined>;
  /**
   * Milliseconds left on the longest live claim another head of the same
   * pull request's brief holds, by the database clock; `undefined` when none.
   */
  readOtherHeadLeaseMs(target: GenerationTarget): Promise<number | undefined>;
  /** The holder moves its phase; `claim-lost` for any other run id. */
  advanceRun(
    target: GenerationTarget,
    runId: string,
    phase: GenerationPhase,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** The holder pushes its lease to `now() + leaseMs`; `updated_at` stays. */
  renewLease(
    target: GenerationTarget,
    runId: string,
    leaseMs: number,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** The holder ends its run and clears the claim; a failure is sanitized as `markFailed` does. */
  finishRun(
    target: GenerationTarget,
    runId: string,
    outcome: RunOutcome,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * End a claim whose holder died once nothing is left to take it over: only
   * a row a lapsed lease still names moves, in one statement, so a claim
   * taken or finished since stays. `claim-lost` otherwise.
   */
  endLapsedClaim(
    target: GenerationTarget,
    outcome: RunOutcome,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * End a row a takeover's shutdown handed back to the head's recovery job:
   * only a `pending` row no claim names and still awaiting recovery moves, in
   * one statement, so a row claimed, gated, finished or re-projected since,
   * or one a regular run's shutdown released, stays. `claim-lost` otherwise.
   */
  endReleasedClaim(
    target: GenerationTarget,
    outcome: RunOutcome,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** The holder hands the row back `pending`; its attempt row stays, it was paid. */
  releaseClaim(
    target: GenerationTarget,
    runId: string,
    options?: ReleaseClaimOptions,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * A rerun found the Brief already stored: a row no run holds that has not
   * succeeded becomes `succeeded` (a failed retry, a claim released at
   * shutdown). Only a row last written at or before `pickedUpAt` settles: a
   * row re-projected after the rerun was picked up is a fresh run's. Takes no
   * claim; any other row is left alone and `undefined` comes back.
   */
  settleStoredBrief(
    target: GenerationTarget,
    pickedUpAt: DatabaseTimestamp,
  ): Promise<GenerationRow | undefined>;
  /**
   * The NEWEST brief-kind projection per PR (by `updated_at`), batched for the
   * list and PR-meta endpoints: its `head_sha` IS the current push, its status
   * drives the wait UX. Span kinds (`delta`, `revision-narrative`) never shadow
   * it; PRs with no brief-kind row are absent from the map.
   */
  latestBriefForPullRequests(
    pullRequestIds: readonly PullRequestRowId[],
  ): Promise<ReadonlyMap<PullRequestRowId, GenerationRow>>;
  /**
   * ALL brief-kind projection rows for ONE PR, the per-revision
   * "generated at" join. One row per briefed head (the natural key), and
   * `created_at` is the FIRST enqueue for that head: a re-queue
   * conflicts and updates in place, so the timestamp stays the earliest
   * bound of what the brief's acquisition could have seen.
   */
  listBriefsForPullRequest(
    pullRequestId: PullRequestRowId,
  ): Promise<readonly GenerationRow[]>;
  /**
   * Terminalize STALE brief projections after a head succeeded: any other
   * head's brief-kind row still `pending`/`running` becomes `superseded`.
   * Covers the pre-drain replace: push B inside the debounce window swaps
   * the job's payload, so no run ever carries head A and its pending row
   * would sit non-terminal forever. Same abort semantics as `markSuperseded`.
   * Only rows last written at or before `pickedUpAt` and claimed by no live
   * lease are taken: a head triggered after pickup may be one the run never
   * saw. Returns the number of rows swept.
   */
  supersedeStaleBriefs(
    pullRequestId: PullRequestRowId,
    currentHeadSha: string,
    pickedUpAt: DatabaseTimestamp,
  ): Promise<number>;
  /** The database clock now, the pickup every `pickedUpAt` fence compares row writes with. */
  readClock(): Promise<DatabaseTimestamp>;
  /**
   * The queued `generate` job for one PR in ctx's scope; `undefined` when the
   * queue holds none. Both answers are computed in SQL, so no `run_at` value
   * leaves the database and no process clock is compared with it.
   */
  getGenerateJobTiming(
    pullRequestId: PullRequestRowId,
  ): Promise<GenerateJobTiming | undefined>;
  /**
   * The newest brief-kind row of one PR, ordered as
   * `latestBriefForPullRequests` orders it, with the claim limit judged by
   * the database clock. `undefined` for no row or a PR outside the scope.
   */
  readBriefClaims(
    pullRequestId: PullRequestRowId,
  ): Promise<BriefClaims | undefined>;
  /**
   * The head's `recover-generation` job; `undefined` when none is queued or
   * the PR sits outside the scope.
   */
  readTakeoverJob(
    pullRequestId: PullRequestRowId,
    headSha: string,
  ): Promise<TakeoverJob | undefined>;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

const INSTANCE_CAP_LOCK_KEY = "generation-cap";

async function countStartedRuns(
  executor: GenerationExecutor,
  { from, to }: { from: Date; to: Date },
): Promise<number> {
  // Deliberately UNSCOPED, a cross-world aggregate in this store. The
  // daily cap is spend protection for the INSTANCE: every started run's
  // units count, whichever repo or door paid for them. Only a count leaves.
  const rows = await executor
    .select({ total: sumInteger(generationAttempt.units) })
    .from(generationAttempt)
    .where(isStartedWithin({ from, to }));
  return rows[0]?.total ?? 0;
}

function sumInteger(column: PgColumn): SQL<number> {
  return sql<number>`coalesce(sum(${column}), 0)::int`.mapWith(Number);
}

function isStartedWithin({ from, to }: { from: Date; to: Date }): SQL {
  const window = and(
    gte(generationAttempt.startedAt, from),
    lt(generationAttempt.startedAt, to),
  );
  return window ?? sql`true`;
}

/**
 * The instance's spend over one UTC day, split into every run and the large
 * runs that claimed more than one unit, with no scope to bind: the spend read
 * answers for the whole instance, as the cap does.
 */
export async function readSpendBreakdown(
  handle: AppDatabase,
  day: { readonly from: Date; readonly to: Date },
): Promise<SpendBreakdown> {
  const isLarge = sql`${generationAttempt.units} > 1`;
  const rows = await internal(handle)
    .select({
      startedUnits: sumInteger(generationAttempt.units),
      largeRuns: count(sql`case when ${isLarge} then 1 end`),
      largeUnits:
        sql<number>`coalesce(sum(${generationAttempt.units}) filter (where ${isLarge}), 0)::int`.mapWith(
          Number,
        ),
    })
    .from(generationAttempt)
    .where(isStartedWithin(day));
  const totals = rows[0];
  return {
    startedUnits: totals?.startedUnits ?? 0,
    largeRuns: {
      runs: totals?.largeRuns ?? 0,
      units: totals?.largeUnits ?? 0,
    },
  };
}

async function recordAttempt(
  executor: GenerationExecutor,
  scope: RowScope,
  generationId: bigint,
  runId: string,
): Promise<void> {
  await executor.insert(generationAttempt).values({
    installationId: scope.installationId,
    runId,
    generationId,
  });
}

/** The day's started count when the cap refuses one more run; `undefined` under it or uncapped. */
async function findCapReached(
  executor: GenerationExecutor,
  window: CapWindow,
): Promise<number | undefined> {
  if (window.cap === undefined) {
    return undefined;
  }
  const started = await countStartedRuns(executor, window);
  if (started < window.cap) {
    return undefined;
  }
  return started;
}

/** Serializes every start on the instance, so the cap count cannot race. */
async function lockInstanceCap(executor: GenerationExecutor): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${INSTANCE_CAP_LOCK_KEY}))`,
  );
}

function computeLeaseEnd(leaseMs: number): SQL {
  return sql`now() + make_interval(secs => ${leaseMs / 1000})`;
}

const clockReadingSchema = z.object({
  rows: z.tuple([z.object({ now: z.string() })]),
});

/**
 * A row write's `updated_at`: the database clock at the statement, never the
 * process clock or `now()`, the transaction's start, which a trigger holding
 * the pull request's lock before it projects may have taken before a pickup.
 */
function stampWriteTime(): SQL {
  return sql`clock_timestamp()`;
}

/** The row's last write is no later than `pickedUpAt`, both on the database clock. */
function isWrittenBy(pickedUpAt: DatabaseTimestamp): SQL {
  return sql`${generation.updatedAt} <= ${pickedUpAt}::timestamptz`;
}

/** A run holds the row and its lease has not lapsed, by the database clock. */
function isLeaseLive(): SQL {
  return sql`(${generation.runId} is not null and ${generation.leaseExpiresAt} > now())`;
}

/**
 * The current push first among one PR's brief-kind rows: the head an accepted
 * trigger named last, whatever its status. Not `updated_at`: an older head's
 * run that finishes after a newer push writes a fresher one, and a sweep
 * writes one to every stale row. A head pushed back to over its stored brief
 * leads even when its row is superseded. id DESC tiebreaks one transaction.
 */
function orderNewestBriefFirst(): SQL[] {
  const newestFirst = [desc(generation.triggeredAt), desc(generation.id)];
  return newestFirst;
}

/** Milliseconds until the lease lapses, zero once lapsed or unset. */
function computeLeaseRemainingMs(): SQL<number> {
  const remainingSeconds = sql`extract(epoch from (${generation.leaseExpiresAt} - now()))`;
  return sql<number>`greatest(0, ceil(${remainingSeconds} * 1000))::int`.mapWith(
    Number,
  );
}

/**
 * What the projection keeps as it is: a live lease, or a `running` row with no
 * claim, which the previous release's worker leaves behind while it runs.
 */
function isProjectionInFlight(): SQL {
  return sql`(${isLeaseLive()} or (${generation.runId} is null and ${generation.status} = ${GenerationStatuses.RUNNING}))`;
}

/**
 * What a trigger keeps as it is: a row the projection keeps in flight, and a
 * `held` one, which the worker checks again on the queued job instead of a
 * reset.
 */
function keepWhileInFlightOrHeld(
  column: PgColumn,
  reset: SQL | string | null,
): SQL {
  return sql`case when ${isProjectionInFlight()} or ${generation.status} = ${GenerationStatuses.HELD} then ${column} else ${reset} end`;
}

/** Every writer clears these, so a row it moves out of `held` drops its conditions. */
const CLAIM_CLEARED = {
  runId: null,
  leaseExpiresAt: null,
  awaitsRecovery: false,
  unmetConditions: null,
} as const;

/**
 * Statuses no unclaimed mark moves: a head waiting for its trigger approval,
 * whose retry would otherwise skip the author gate, a held head, which a new
 * push leaves stored as it is, and a head whose brief is stored.
 */
/** A rerun of a failure with one of these codes fails the same way and still spends. */
export function isHopelessFailure(
  errorCode: GenerationFailureCode | null,
): boolean {
  if (errorCode === null) {
    return false;
  }
  const failureClass = GenerationFailureClassByCode[errorCode];
  return failureClass === GenerationFailureClasses.CANNOT_HELP;
}

const HOPELESS_FAILURE_CODES = Object.values(GenerationFailureCodes).filter(
  (code) => isHopelessFailure(code),
);

/** A failed row whose code `isHopelessFailure` names. */
function isHopelessFailedRow(): SQL {
  return (
    and(
      eq(generation.status, GenerationStatuses.FAILED),
      isNotNull(generation.errorCode),
      inArray(generation.errorCode, HOPELESS_FAILURE_CODES),
    ) ?? sql`false`
  );
}

const KEPT_STATUSES: readonly GenerationStatus[] = [
  GenerationStatuses.AWAITING_TRIGGER,
  GenerationStatuses.HELD,
  GenerationStatuses.SUCCEEDED,
];

const TERMINAL_CLEARED = {
  ...CLAIM_CLEARED,
  phase: null,
  errorCode: null,
  errorParams: null,
} as const;

/**
 * A trigger's reset of a row already on the key: `status` with `attempts` as
 * given, clearing `phase`, the error columns, `repo_config` and the claim. An
 * in-flight head keeps every column, so a live run is never clobbered and a
 * dropped trigger is not a paid attempt; so does a `held` row, so the inbox
 * never flashes queued between checks. A `running` row whose lease lapsed (a
 * dead worker) is projected afresh.
 */
function buildTriggerReset(
  status: GenerationStatus,
  attempts: SQL,
): GenerationSet {
  return {
    status: keepWhileInFlightOrHeld(generation.status, status),
    attempts: keepWhileInFlightOrHeld(generation.attempts, attempts),
    phase: keepWhileInFlightOrHeld(generation.phase, null),
    errorCode: keepWhileInFlightOrHeld(generation.errorCode, null),
    errorParams: keepWhileInFlightOrHeld(generation.errorParams, null),
    repoConfig: keepWhileInFlightOrHeld(generation.repoConfig, null),
    runId: keepWhileInFlightOrHeld(generation.runId, null),
    leaseExpiresAt: keepWhileInFlightOrHeld(generation.leaseExpiresAt, null),
    claims: keepWhileInFlightOrHeld(generation.claims, sql`0`),
    awaitsRecovery: keepWhileInFlightOrHeld(
      generation.awaitsRecovery,
      sql`false`,
    ),
    unmetConditions: keepWhileInFlightOrHeld(generation.unmetConditions, null),
    updatedAt: stampWriteTime(),
  };
}

/** How a refused claim ends a row that neither settles nor already failed. */
interface RefusedClaimMark {
  readonly set: GenerationSet;
  readonly errorCode?: GenerationFailureCode;
  /** An earlier failure the row keeps still has its failed Entry synced. */
  readonly syncsKeptFailure: boolean;
}

const EXHAUSTED_END: GenerationSet = {
  ...CLAIM_CLEARED,
  status: GenerationStatuses.FAILED,
  phase: null,
  errorCode: GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
  errorParams: null,
};

const CAPPED_END: GenerationSet = {
  ...TERMINAL_CLEARED,
  status: GenerationStatuses.CAPPED,
};

/** A no-op write, so the conflict still returns the row as stored. */
const KEEP_STORED_ROW: GenerationSet = { status: sql`${generation.status}` };

/**
 * A trigger's projection: insert at `status` with `attempts = 0`, or apply
 * `onConflict` to the row on the same key (NULLS NOT DISTINCT). It never
 * moves `triggered_at`: ingest stamps that through `stampBriefTriggered`.
 */
async function projectTriggeredRow(
  executor: GenerationExecutor,
  scope: RowScope,
  target: GenerationTarget,
  status: GenerationStatus,
  onConflict: GenerationSet,
): Promise<ProjectedGeneration> {
  const rows = await executor
    .insert(generation)
    .values({
      installationId: scope.installationId,
      pullRequestId: target.pullRequestId,
      kind: target.kind,
      headSha: target.headSha,
      baselineSha: target.baselineSha,
      status,
    })
    .onConflictDoUpdate({
      target: [
        generation.installationId,
        generation.pullRequestId,
        generation.kind,
        generation.headSha,
        generation.baselineSha,
      ],
      set: onConflict,
    })
    .returning({
      ...getTableColumns(generation),
      inFlight: sql<boolean>`${isProjectionInFlight()}`,
    });
  const projected = rows[0];
  if (projected === undefined) {
    throw new Error("generation projection returned no row");
  }

  const { inFlight, ...row } = projected;
  return { row, inFlight };
}

/**
 * The pending projection both ingest and the worker write. A re-queue of the
 * same key increments `attempts`.
 */
export async function projectPendingGeneration(
  executor: GenerationExecutor,
  scope: RowScope,
  target: GenerationTarget,
): Promise<ProjectedGeneration> {
  const pending = GenerationStatuses.PENDING;
  const requeued = sql`${generation.attempts} + 1`;
  return projectTriggeredRow(
    executor,
    scope,
    target,
    pending,
    buildTriggerReset(pending, requeued),
  );
}

/**
 * Ingest's projection for a head whose PR still needs a collaborator's
 * approval. Only a head's first projection waits: a row already on the key
 * keeps every column, so no gate verdict moves a head an earlier trigger
 * projected. Waiting is not an attempt.
 */
export async function projectAwaitingTrigger(
  executor: GenerationExecutor,
  scope: RowScope,
  target: GenerationTarget,
): Promise<ProjectedGeneration> {
  return projectTriggeredRow(
    executor,
    scope,
    target,
    GenerationStatuses.AWAITING_TRIGGER,
    KEEP_STORED_ROW,
  );
}

/**
 * An approved PR's held head goes back to `pending` with a fresh claim
 * budget, as a trigger projects it. Only a row still `awaiting-trigger`
 * moves; the caller holds the pull request's row lock and has read the
 * approval under it.
 */
export async function releaseAwaitingTrigger(
  executor: GenerationExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  headSha: string,
): Promise<boolean> {
  const pending = GenerationStatuses.PENDING;
  const requeued = sql`${generation.attempts} + 1`;
  const released = await executor
    .update(generation)
    .set(buildTriggerReset(pending, requeued))
    .where(
      and(
        scope.matchesChild(generation.installationId, generation.pullRequestId),
        eq(generation.pullRequestId, pullRequestId),
        eq(generation.kind, GenerationKinds.BRIEF),
        eq(generation.headSha, headSha),
        isNull(generation.baselineSha),
        eq(generation.status, GenerationStatuses.AWAITING_TRIGGER),
      ),
    )
    .returning({ id: generation.id });
  return released.length > 0;
}

/**
 * A Generate click on a held head: back to `pending` with a fresh claim
 * budget, its unmet conditions cleared, and stamped so every run of that
 * head skips the conditions. Only a `held` row moves; the caller holds the
 * pull request's row lock, which a condition hold also takes.
 */
export async function releaseHeldHead(
  executor: GenerationExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  headSha: string,
): Promise<boolean> {
  const released = await executor
    .update(generation)
    .set({
      status: GenerationStatuses.PENDING,
      attempts: sql`${generation.attempts} + 1`,
      claims: 0,
      unmetConditions: null,
      generateRequestedAt: sql`clock_timestamp()`,
      updatedAt: stampWriteTime(),
    })
    .where(
      and(
        scope.matchesChild(generation.installationId, generation.pullRequestId),
        eq(generation.pullRequestId, pullRequestId),
        eq(generation.kind, GenerationKinds.BRIEF),
        eq(generation.headSha, headSha),
        isNull(generation.baselineSha),
        eq(generation.status, GenerationStatuses.HELD),
      ),
    )
    .returning({ id: generation.id });
  return released.length > 0;
}

/**
 * Stamp a head a Generate click queued, so every run of that head skips the
 * trigger conditions; the caller holds the pull request's row lock.
 */
export async function stampGenerateRequested(
  executor: GenerationExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  headSha: string,
): Promise<void> {
  await executor
    .update(generation)
    .set({ generateRequestedAt: sql`clock_timestamp()` })
    .where(
      and(
        scope.matchesChild(generation.installationId, generation.pullRequestId),
        eq(generation.pullRequestId, pullRequestId),
        eq(generation.kind, GenerationKinds.BRIEF),
        eq(generation.headSha, headSha),
        isNull(generation.baselineSha),
      ),
    );
}

/**
 * An accepted trigger names its head as the current push. Only ingest calls
 * this: a worker projecting its own head never moves the order. The clock is
 * read at the write, after the trigger holds the pull request's row lock, so
 * two triggers for one PR stamp in the order they took it, not in the order
 * their transactions began.
 */
export async function stampBriefTriggered(
  executor: GenerationExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  headSha: string,
): Promise<void> {
  const sameHead = and(
    scope.matchesChild(generation.installationId, generation.pullRequestId),
    eq(generation.pullRequestId, pullRequestId),
    eq(generation.kind, GenerationKinds.BRIEF),
    eq(generation.headSha, headSha),
  );
  await executor
    .update(generation)
    .set({ triggeredAt: sql`clock_timestamp()` })
    .where(sameHead);
}

/**
 * The PR's current push, ordered as `latestBriefForPullRequests` orders it,
 * with whether the projection holds it, by the database clock.
 */
export async function readCurrentBriefHead(
  executor: GenerationExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
): Promise<ProjectedGeneration | undefined> {
  const rows = await executor
    .select({
      row: getTableColumns(generation),
      inFlight: sql<boolean>`${isProjectionInFlight()}`,
    })
    .from(generation)
    .where(
      and(
        scope.matchesChild(generation.installationId, generation.pullRequestId),
        eq(generation.kind, GenerationKinds.BRIEF),
        eq(generation.pullRequestId, pullRequestId),
      ),
    )
    .orderBy(...orderNewestBriefFirst())
    .limit(1);
  return rows[0];
}

function shapeFailure(failure: GenerationFailure) {
  // An empty sanitized detail (empty message, leading newline) drops to
  // null params so readers fall back to the code, per the sanitizer's
  // gate-on-the-result contract.
  const detail =
    "params" in failure ? sanitizeErrorDetail(failure.params.detail) : "";
  return {
    status: GenerationStatuses.FAILED,
    errorCode: failure.code,
    errorParams: detail === "" ? null : { detail },
  };
}

function shapeRunEnd(outcome: RunOutcome): GenerationSet {
  if (outcome.status === GenerationStatuses.FAILED) {
    return {
      ...shapeFailure(outcome.failure),
      ...CLAIM_CLEARED,
      phase: null,
      awaitsRecovery: outcome.awaitsRecovery === true,
    };
  }
  if (outcome.status === GenerationStatuses.CAPPED) {
    return {
      ...TERMINAL_CLEARED,
      status: outcome.status,
      errorParams: {
        needed: outcome.units.needed,
        left: outcome.units.left,
        cap: outcome.units.cap,
      },
    };
  }
  return { ...TERMINAL_CLEARED, status: outcome.status };
}

/** Build a tenant-scoped `generation` projection over the opaque handle. */
export function createGenerationProjection(
  handle: AppDatabase,
  ctx: ScopeContext,
): GenerationProjection {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  async function isPullRequestInScope(
    pullRequestId: PullRequestRowId,
  ): Promise<boolean> {
    const ownRow = and(
      scope.matchesPullRequest(),
      eq(pullRequest.id, pullRequestId),
    );
    const inScope = await db
      .select({ id: pullRequest.id })
      .from(pullRequest)
      .where(ownRow)
      .limit(1);
    return inScope[0] !== undefined;
  }

  /** Full natural-key predicate; `baseline_sha` matched with IS NULL when null. */
  function keyWhere(target: GenerationTarget) {
    return and(
      scope.matchesChild(generation.installationId, generation.pullRequestId),
      eq(generation.pullRequestId, target.pullRequestId),
      eq(generation.kind, target.kind),
      eq(generation.headSha, target.headSha),
      target.baselineSha === null
        ? isNull(generation.baselineSha)
        : eq(generation.baselineSha, target.baselineSha),
    );
  }

  async function transition(
    target: GenerationTarget,
    set: GenerationSet,
    options: TransitionOptions = {},
  ): Promise<Result<GenerationRow, GenerationError>> {
    const executor = options.executor ?? db;
    const write: GenerationSet = { ...set };
    if (options.keepUpdatedAt !== true) {
      write.updatedAt = stampWriteTime();
    }
    const rows = await executor
      .update(generation)
      .set(write)
      .where(and(keyWhere(target), options.guard))
      .returning();
    const row = rows[0];
    if (row === undefined) {
      return failClaimLost(target);
    }
    return { ok: true, value: row };
  }

  /** No row the key and guard both match: another run holds it, or it is gone. */
  function failClaimLost(
    target: GenerationTarget,
  ): Result<never, GenerationError> {
    return fail(
      GenerationErrorCodes.CLAIM_LOST,
      `generation ${target.kind}@${target.headSha} is claimed by another run or gone`,
    );
  }

  /** A transition only the claim holder may make. */
  async function fencedTransition(
    target: GenerationTarget,
    runId: string,
    set: GenerationSet,
    options: Pick<TransitionOptions, "keepUpdatedAt"> = {},
  ): Promise<Result<GenerationRow, GenerationError>> {
    return transition(target, set, {
      ...options,
      guard: eq(generation.runId, runId),
    });
  }

  /**
   * The hold, in the pull request's lock order: an approval locks the PR row
   * before it writes the head, so the approval this reads is the last one
   * committed, and a click cannot land between the read and the write.
   */
  async function holdForApproval(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>> {
    return db.transaction(async (tx) => {
      const locked = await tx
        .select({ triggerApprovedAt: pullRequest.triggerApprovedAt })
        .from(pullRequest)
        .where(
          and(
            scope.matchesPullRequest(),
            eq(pullRequest.id, target.pullRequestId),
          ),
        )
        .limit(1)
        .for("update");
      const prRow = locked[0];
      if (prRow === undefined) {
        return failClaimLost(target);
      }
      if (prRow.triggerApprovedAt !== null) {
        return fail(
          GenerationErrorCodes.TRIGGER_APPROVED,
          `pull request ${target.pullRequestId} is approved, ${target.headSha} is not held`,
        );
      }

      const unsettled = ne(generation.status, GenerationStatuses.SUCCEEDED);
      const marked = await transition(
        target,
        { ...TERMINAL_CLEARED, status: GenerationStatuses.AWAITING_TRIGGER },
        { executor: tx, guard: sql`(not ${isLeaseLive()} and ${unsettled})` },
      );
      if (marked.ok) {
        return marked;
      }
      return readKeptStatus(tx, target, marked);
    });
  }

  /**
   * The condition hold, in the same lock order as a Generate click: the
   * click locks the pull request's row before it releases and stamps the
   * head, so a hold written after it finds the stamp and stands down.
   */
  async function holdForConditions(
    target: GenerationTarget,
    unmetConditions: readonly UnmetCondition[],
  ): Promise<Result<GenerationRow, GenerationError>> {
    const stored = truncateUnmetConditions(unmetConditions);
    const document = JSON.stringify(UnmetConditionsSchema.parse(stored));
    return db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: pullRequest.id })
        .from(pullRequest)
        .where(
          and(
            scope.matchesPullRequest(),
            eq(pullRequest.id, target.pullRequestId),
          ),
        )
        .limit(1)
        .for("update");
      if (locked[0] === undefined) {
        return failClaimLost(target);
      }

      const holdable = and(
        not(isLeaseLive()),
        inArray(generation.status, [
          GenerationStatuses.PENDING,
          GenerationStatuses.HELD,
          GenerationStatuses.FAILED,
        ]),
        not(isHopelessFailedRow()),
        isNull(generation.generateRequestedAt),
      );
      const marked = await transition(
        target,
        {
          ...TERMINAL_CLEARED,
          status: GenerationStatuses.HELD,
          unmetConditions: document,
          claims: 0,
        },
        { executor: tx, guard: holdable ?? sql`false` },
      );
      if (marked.ok) {
        return marked;
      }
      const stamped = await tx
        .select({ at: generation.generateRequestedAt })
        .from(generation)
        .where(keyWhere(target))
        .limit(1);
      if (stamped[0]?.at !== undefined && stamped[0].at !== null) {
        return fail(
          GenerationErrorCodes.STATUS_KEPT,
          `generation ${target.kind}@${target.headSha} was released by a Generate click`,
        );
      }
      return readKeptStatus(tx, target, marked);
    });
  }

  /** A refused write on a kept status says so; any other refusal stands. */
  async function readKeptStatus(
    executor: GenerationExecutor,
    target: GenerationTarget,
    refused: Result<GenerationRow, GenerationError>,
  ): Promise<Result<GenerationRow, GenerationError>> {
    const rows = await executor
      .select({ status: generation.status })
      .from(generation)
      .where(keyWhere(target))
      .limit(1);
    const status = rows[0]?.status;
    const kept = status !== undefined && KEPT_STATUSES.includes(status);
    if (kept) {
      return fail(
        GenerationErrorCodes.STATUS_KEPT,
        `generation ${target.kind}@${target.headSha} is ${status}`,
      );
    }
    return refused;
  }

  /** A terminal mark on a row nobody holds, refused on a status the mark must keep. */
  async function applyUnclaimedMark(
    target: GenerationTarget,
    set: GenerationSet,
  ): Promise<Result<GenerationRow, GenerationError>> {
    const unkept = notInArray(generation.status, [...KEPT_STATUSES]);
    const marked = await transition(target, set, {
      guard: sql`(not ${isLeaseLive()} and ${unkept})`,
    });
    if (marked.ok) {
      return marked;
    }
    return readKeptStatus(db, target, marked);
  }

  async function readRow(
    target: GenerationTarget,
  ): Promise<GenerationRow | undefined> {
    const rows = await db
      .select()
      .from(generation)
      .where(keyWhere(target))
      .limit(1);
    return rows[0];
  }

  /**
   * A refused claim's end, under the claim's row lock: a stored brief settles
   * the row, an earlier failure stays, anything else takes `mark`. The Entry
   * sync is queued with it, so a worker dying before its own post still gets
   * the Entry the row names; a settle's is the ready body, which an exhausted
   * run never posts itself.
   */
  async function endRefusedClaim(
    executor: GenerationExecutor,
    input: ClaimRunInput,
    current: Pick<GenerationRow, "status" | "errorCode">,
    mark: RefusedClaimMark,
  ): Promise<RefusedClaimEnd> {
    const { target, storedBrief } = input;
    if (storedBrief !== undefined) {
      const settled = await settleRow(executor, target, storedBrief.pickedUpAt);
      if (settled === undefined) {
        return { end: ClaimEnds.LEFT };
      }
      await queueClaimEntrySync(executor, input);
      return { end: ClaimEnds.SETTLED };
    }

    if (current.status === GenerationStatuses.FAILED) {
      if (mark.syncsKeptFailure) {
        await queueClaimEntrySync(executor, input);
      }
      const kept: Mutable<RefusedClaimEnd> = { end: ClaimEnds.KEPT_FAILED };
      const errorCode = current.errorCode ?? mark.errorCode;
      if (errorCode !== undefined) {
        kept.errorCode = errorCode;
      }
      return kept;
    }

    await queueClaimEntrySync(executor, input);
    const marked = await transition(target, mark.set, { executor });
    if (!marked.ok) {
      throw new Error(`generation ${target.headSha} vanished under its lock`);
    }
    const ended: Mutable<RefusedClaimEnd> = { end: ClaimEnds.MARKED };
    if (mark.errorCode !== undefined) {
      ended.errorCode = mark.errorCode;
    }
    return ended;
  }

  async function queueClaimEntrySync(
    executor: GenerationExecutor,
    input: ClaimRunInput,
  ): Promise<void> {
    const { target, entrySync } = input;
    const writesNoEntry = entrySync === undefined || scope.ownerUserId !== null;
    if (writesNoEntry) {
      return;
    }
    await addEntrySyncJob(
      executor,
      scope,
      target.pullRequestId,
      target.headSha,
      entrySync.delaySeconds,
    );
  }

  /** A row no run holds that has not succeeded and was last written by `pickedUpAt` becomes `succeeded`. */
  async function settleRow(
    executor: GenerationExecutor,
    target: GenerationTarget,
    pickedUpAt: DatabaseTimestamp,
  ): Promise<GenerationRow | undefined> {
    const rows = await executor
      .update(generation)
      .set({
        ...TERMINAL_CLEARED,
        status: GenerationStatuses.SUCCEEDED,
        updatedAt: stampWriteTime(),
      })
      .where(
        and(
          keyWhere(target),
          ne(generation.status, GenerationStatuses.SUCCEEDED),
          not(isProjectionInFlight()),
          isWrittenBy(pickedUpAt),
        ),
      )
      .returning();
    return rows[0];
  }

  async function claimRow(
    executor: GenerationExecutor,
    input: ClaimRunInput,
  ): Promise<Result<ClaimRunOutcome, GenerationError>> {
    const { target, phase, leaseMs } = input;
    const found = await executor
      .select({
        status: generation.status,
        errorCode: generation.errorCode,
        claims: generation.claims,
        leaseLive: sql<boolean>`${isLeaseLive()}`,
        leaseRemainingMs: computeLeaseRemainingMs(),
      })
      .from(generation)
      .where(keyWhere(target))
      .limit(1)
      .for("update");
    const current = found[0];
    if (current === undefined) {
      return failClaimLost(target);
    }
    if (current.status === GenerationStatuses.SUCCEEDED) {
      return { ok: true, value: { kind: ClaimOutcomes.FINISHED } };
    }
    if (current.status === GenerationStatuses.AWAITING_TRIGGER) {
      return { ok: true, value: { kind: ClaimOutcomes.AWAITING_TRIGGER } };
    }
    const hopeless =
      current.status === GenerationStatuses.FAILED &&
      isHopelessFailure(current.errorCode);
    if (hopeless) {
      return { ok: true, value: { kind: ClaimOutcomes.HOPELESS } };
    }
    if (current.leaseLive) {
      return {
        ok: true,
        value: {
          kind: ClaimOutcomes.RUNNING,
          leaseRemainingMs: current.leaseRemainingMs,
        },
      };
    }
    if (current.claims >= MAX_GENERATION_ATTEMPTS) {
      const ended = await endRefusedClaim(executor, input, current, {
        set: EXHAUSTED_END,
        errorCode: GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
        syncsKeptFailure: true,
      });
      return {
        ok: true,
        value: {
          kind: ClaimOutcomes.EXHAUSTED,
          claims: current.claims,
          ...ended,
        },
      };
    }
    const startedRuns = await findCapReached(executor, input);
    if (startedRuns !== undefined) {
      const ended = await endRefusedClaim(executor, input, current, {
        set: CAPPED_END,
        syncsKeptFailure: false,
      });
      return {
        ok: true,
        value: { kind: ClaimOutcomes.CAPPED, startedRuns, ...ended },
      };
    }

    const runId = randomUUID();
    const claimed = await transition(
      target,
      {
        status: GenerationStatuses.RUNNING,
        phase: phase ?? null,
        errorCode: null,
        errorParams: null,
        unmetConditions: null,
        runId,
        leaseExpiresAt: computeLeaseEnd(leaseMs),
        claims: sql`${generation.claims} + 1`,
        awaitsRecovery: false,
      },
      { executor },
    );
    if (!claimed.ok) {
      return claimed;
    }
    await recordAttempt(executor, scope, claimed.value.id, runId);
    if (input.recovery !== undefined) {
      await addQueueJob(executor, {
        identifier: QueueTasks.RECOVER_GENERATION,
        payload: buildJobPayload(
          scope,
          input.recovery.grantId,
          target.pullRequestId,
          target.headSha,
        ),
        key: getRecoveryJobKey(target.pullRequestId, target.headSha),
        delaySeconds: input.recovery.delaySeconds,
        keyMode: JobKeyModes.REPLACE,
      });
    }
    return {
      ok: true,
      value: {
        kind: ClaimOutcomes.CLAIMED,
        runId,
        createdAt: claimed.value.createdAt,
        claims: claimed.value.claims,
      },
    };
  }

  /** The run's attempt row, through its `generation` row's scope check. */
  function matchesAttempt(runId: string): SQL {
    const ownGenerations = sql`select ${generation.id} from ${generation}
      where ${scope.matchesChild(generation.installationId, generation.pullRequestId)}`;
    const attempt = and(
      scope.matchesWorld(generationAttempt.installationId),
      eq(generationAttempt.runId, runId),
      sql`${generationAttempt.generationId} in (${ownGenerations})`,
    );
    return attempt ?? sql`false`;
  }

  function failAttemptLost(runId: string): Result<never, GenerationError> {
    return fail(
      GenerationErrorCodes.CLAIM_LOST,
      `generation attempt ${runId} is gone from ${scope.label}`,
    );
  }

  async function claimAttemptUnits(
    executor: GenerationExecutor,
    input: ClaimUnitsInput,
  ): Promise<Result<ClaimUnitsOutcome, GenerationError>> {
    const found = await executor
      .select({
        units: generationAttempt.units,
        startedAt: generationAttempt.startedAt,
      })
      .from(generationAttempt)
      .where(matchesAttempt(input.runId))
      .limit(1);
    const attempt = found[0];
    if (attempt === undefined) {
      return failAttemptLost(input.runId);
    }
    // A run started before the claim's day moves onto it with every unit it
    // holds: the claim day may overcount, but no claim escapes its cap.
    const crossedMidnight = attempt.startedAt < input.from;
    const carriedUnits = crossedMidnight ? attempt.units : 0;
    if (input.cap !== undefined) {
      const started = await countStartedRuns(executor, input);
      const left = Math.max(0, input.cap - started - carriedUnits);
      if (input.units > left) {
        return {
          ok: true,
          value: {
            kind: ChargeOutcomes.CAPPED,
            needed: input.units,
            left,
            cap: input.cap,
          },
        };
      }
    }

    const booking: PgUpdateSetSource<typeof generationAttempt> = {
      units: sql`${generationAttempt.units} + ${input.units}`,
    };
    if (crossedMidnight) {
      booking.startedAt = input.from;
    }
    await executor
      .update(generationAttempt)
      .set(booking)
      .where(matchesAttempt(input.runId));
    return { ok: true, value: { kind: ChargeOutcomes.CHARGED } };
  }

  async function chargeRow(
    executor: GenerationExecutor,
    input: ChargeRunInput,
  ): Promise<Result<ChargeRunOutcome, GenerationError>> {
    const startedRuns = await findCapReached(executor, input);
    if (startedRuns !== undefined) {
      return { ok: true, value: { kind: ChargeOutcomes.CAPPED, startedRuns } };
    }

    const found = await executor
      .select({ id: generation.id })
      .from(generation)
      .where(keyWhere(input.target))
      .limit(1);
    const row = found[0];
    if (row === undefined) {
      return failClaimLost(input.target);
    }
    const runId = randomUUID();
    await recordAttempt(executor, scope, row.id, runId);
    return { ok: true, value: { kind: ChargeOutcomes.CHARGED, runId } };
  }

  return traceStore("generationProjection", {
    ctx,

    async upsertPending(target) {
      return db.transaction(async (tx) => {
        const parents = await tx
          .select({ id: pullRequest.id })
          .from(pullRequest)
          .where(
            and(
              scope.matchesPullRequest(),
              eq(pullRequest.id, target.pullRequestId),
            ),
          )
          .limit(1);
        if (parents[0] === undefined) {
          throw new ScopeViolationError(
            "pull_request",
            target.pullRequestId,
            scope.label,
          );
        }
        const projected = await projectPendingGeneration(tx, scope, target);
        return projected.row;
      });
    },

    async markSuperseded(target) {
      // Not a failure, so `attempts` is deliberately left untouched.
      return applyUnclaimedMark(target, {
        ...TERMINAL_CLEARED,
        status: GenerationStatuses.SUPERSEDED,
      });
    },

    async markCapped(target) {
      // Same abort semantics as markSuperseded: the run never started, so
      // `attempts` stays untouched and nothing is retried.
      return applyUnclaimedMark(target, {
        ...TERMINAL_CLEARED,
        status: GenerationStatuses.CAPPED,
      });
    },

    async markAwaitingTrigger(target) {
      return holdForApproval(target);
    },

    async markHeld(target, unmetConditions) {
      return holdForConditions(target, unmetConditions);
    },

    async markFailed(target, failure) {
      return applyUnclaimedMark(target, {
        ...shapeFailure(failure),
        ...CLAIM_CLEARED,
      });
    },

    async recordRepoConfig(target, runId, repoConfig) {
      return fencedTransition(target, runId, { repoConfig });
    },

    async get(target) {
      return readRow(target);
    },

    async countStartedRuns(input) {
      return countStartedRuns(db, input);
    },

    async claimRun(input) {
      return db.transaction(async (tx) => {
        if (input.cap !== undefined) {
          await lockInstanceCap(tx);
        }
        return claimRow(tx, input);
      });
    },

    async chargeRun(input) {
      return db.transaction(async (tx) => {
        if (input.cap !== undefined) {
          await lockInstanceCap(tx);
        }
        return chargeRow(tx, input);
      });
    },

    async claimUnits(input) {
      if (!Number.isInteger(input.units) || input.units < 1) {
        throw new Error(
          `claimUnits: units must be a positive integer, got ${input.units}`,
        );
      }
      return db.transaction(async (tx) => {
        if (input.cap !== undefined) {
          await lockInstanceCap(tx);
        }
        return claimAttemptUnits(tx, input);
      });
    },

    async refundRun(runId) {
      const rows = await db
        .update(generationAttempt)
        .set({ units: 0 })
        .where(matchesAttempt(runId))
        .returning({ runId: generationAttempt.runId });
      if (rows[0] === undefined) {
        return failAttemptLost(runId);
      }
      return { ok: true, value: undefined };
    },

    async recordPartDone(runId) {
      const rows = await db
        .update(generationAttempt)
        .set({ partsDone: sql`${generationAttempt.partsDone} + 1` })
        .where(matchesAttempt(runId))
        .returning({ partsDone: generationAttempt.partsDone });
      const row = rows[0];
      if (row === undefined) {
        return failAttemptLost(runId);
      }
      return { ok: true, value: row.partsDone };
    },

    async recordPartsPlanned(runId, plan) {
      const wholePlan =
        Number.isInteger(plan.total) &&
        Number.isInteger(plan.done) &&
        plan.done >= 0 &&
        plan.total >= plan.done;
      if (!wholePlan) {
        throw new RangeError(
          `recordPartsPlanned: a plan counts whole parts, got ${plan.done} of ${plan.total}`,
        );
      }
      const rows = await db
        .update(generationAttempt)
        .set({ partsTotal: plan.total, partsDone: plan.done })
        .where(matchesAttempt(runId))
        .returning({ runId: generationAttempt.runId });
      if (rows[0] === undefined) {
        return failAttemptLost(runId);
      }
      return { ok: true, value: undefined };
    },

    async readRunAttempt(runId) {
      const rows = await db
        .select({
          recordedAt: generationAttempt.recordedAt,
          units: generationAttempt.units,
          partsDone: generationAttempt.partsDone,
          partsTotal: generationAttempt.partsTotal,
        })
        .from(generationAttempt)
        .where(matchesAttempt(runId))
        .limit(1);
      return rows[0];
    },

    async readClaim(target) {
      const rows = await db
        .select({
          claimed: sql<boolean>`${generation.runId} is not null`,
          leaseLive: sql<boolean>`${isLeaseLive()}`,
          leaseRemainingMs: computeLeaseRemainingMs(),
          awaitsRecovery: generation.awaitsRecovery,
        })
        .from(generation)
        .where(keyWhere(target))
        .limit(1);
      return rows[0];
    },

    async readOtherHeadLeaseMs(target) {
      const leaseRemainingMs = computeLeaseRemainingMs();
      const rows = await db
        .select({ leaseRemainingMs })
        .from(generation)
        .where(
          and(
            scope.matchesChild(
              generation.installationId,
              generation.pullRequestId,
            ),
            eq(generation.pullRequestId, target.pullRequestId),
            eq(generation.kind, GenerationKinds.BRIEF),
            ne(generation.headSha, target.headSha),
            isLeaseLive(),
          ),
        )
        .orderBy(desc(leaseRemainingMs))
        .limit(1);
      return rows[0]?.leaseRemainingMs;
    },

    async advanceRun(target, runId, phase) {
      return fencedTransition(target, runId, {
        status: GenerationStatuses.RUNNING,
        phase,
      });
    },

    async renewLease(target, runId, leaseMs) {
      return fencedTransition(
        target,
        runId,
        { leaseExpiresAt: computeLeaseEnd(leaseMs) },
        { keepUpdatedAt: true },
      );
    },

    async finishRun(target, runId, outcome) {
      return fencedTransition(target, runId, shapeRunEnd(outcome));
    },

    async endLapsedClaim(target, outcome) {
      const lapsed = sql`(${generation.runId} is not null and not ${isLeaseLive()})`;
      return transition(target, shapeRunEnd(outcome), { guard: lapsed });
    },

    async endReleasedClaim(target, outcome) {
      const released = sql`(${generation.runId} is null and ${generation.status} = ${GenerationStatuses.PENDING} and ${generation.awaitsRecovery})`;
      return transition(target, shapeRunEnd(outcome), { guard: released });
    },

    async releaseClaim(target, runId, options) {
      return fencedTransition(target, runId, {
        ...CLAIM_CLEARED,
        status: GenerationStatuses.PENDING,
        phase: null,
        awaitsRecovery: options?.awaitsRecovery === true,
      });
    },

    async settleStoredBrief(target, pickedUpAt) {
      return settleRow(db, target, pickedUpAt);
    },

    async latestBriefForPullRequests(pullRequestIds) {
      if (pullRequestIds.length === 0) {
        return new Map();
      }
      const rows = await db
        .selectDistinctOn([generation.pullRequestId])
        .from(generation)
        .where(
          and(
            scope.matchesChild(
              generation.installationId,
              generation.pullRequestId,
            ),
            eq(generation.kind, GenerationKinds.BRIEF),
            inArray(generation.pullRequestId, [...pullRequestIds]),
          ),
        )
        .orderBy(asc(generation.pullRequestId), ...orderNewestBriefFirst());
      return new Map(rows.map((row) => [row.pullRequestId, row]));
    },

    async listBriefsForPullRequest(pullRequestId) {
      return db
        .select()
        .from(generation)
        .where(
          and(
            scope.matchesChild(
              generation.installationId,
              generation.pullRequestId,
            ),
            eq(generation.kind, GenerationKinds.BRIEF),
            eq(generation.pullRequestId, pullRequestId),
          ),
        )
        .orderBy(asc(generation.id));
    },

    async supersedeStaleBriefs(pullRequestId, currentHeadSha, pickedUpAt) {
      const rows = await db
        .update(generation)
        .set({
          ...TERMINAL_CLEARED,
          status: GenerationStatuses.SUPERSEDED,
          updatedAt: stampWriteTime(),
        })
        .where(
          and(
            scope.matchesChild(
              generation.installationId,
              generation.pullRequestId,
            ),
            eq(generation.pullRequestId, pullRequestId),
            eq(generation.kind, GenerationKinds.BRIEF),
            ne(generation.headSha, currentHeadSha),
            inArray(generation.status, [
              GenerationStatuses.PENDING,
              GenerationStatuses.RUNNING,
            ]),
            isWrittenBy(pickedUpAt),
            not(isLeaseLive()),
          ),
        )
        .returning({ id: generation.id });
      return rows.length;
    },

    async readClock() {
      const result = await db.execute(
        sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
      );
      const now = clockReadingSchema.parse(result).rows[0].now;
      if (!isDatabaseTimestamp(now)) {
        throw new Error(`the database clock read as ${now}`);
      }
      return now;
    },

    async getGenerateJobTiming(pullRequestId) {
      if (!(await isPullRequestInScope(pullRequestId))) {
        return undefined;
      }

      const job = await readQueueJob(db, getGenerateJobKey(pullRequestId));
      if (job === undefined) {
        return undefined;
      }
      return {
        startsLater: job.startsLater,
        locked: job.locked,
        hasAttemptsLeft: job.hasAttemptsLeft,
      };
    },

    async readBriefClaims(pullRequestId) {
      const briefRows = and(
        scope.matchesChild(generation.installationId, generation.pullRequestId),
        eq(generation.kind, GenerationKinds.BRIEF),
        eq(generation.pullRequestId, pullRequestId),
      );
      const rows = await db
        .select({
          row: getTableColumns(generation),
          leaseLive: sql<boolean>`${isLeaseLive()}`,
        })
        .from(generation)
        .where(briefRows)
        .orderBy(...orderNewestBriefFirst())
        .limit(1);
      const found = rows[0];
      if (found === undefined) {
        return undefined;
      }

      const unfinished = found.row.status !== GenerationStatuses.SUCCEEDED;
      const limitSpent = found.row.claims >= MAX_GENERATION_ATTEMPTS;
      const exhausted = unfinished && !found.leaseLive && limitSpent;
      return { generation: found.row, exhausted };
    },

    async readTakeoverJob(pullRequestId, headSha) {
      if (!(await isPullRequestInScope(pullRequestId))) {
        return undefined;
      }

      const job = await readQueueJob(
        db,
        getRecoveryJobKey(pullRequestId, headSha),
      );
      if (job === undefined) {
        return undefined;
      }
      if (job.locked) {
        return { state: TakeoverJobStates.RUNNING };
      }
      if (!job.hasAttemptsLeft) {
        return { state: TakeoverJobStates.SPENT };
      }
      return { state: TakeoverJobStates.SCHEDULED, runsAt: job.runAt };
    },
  });
}
