// The `generation` status-projection write helpers: a mutable CQRS mirror of a
// worker job, never a queue or a domain entity. graphile-worker deletes
// succeeded jobs, so the web tier polls this; retries live in graphile. A run
// claims the row (`run_id` under a lease the database clock judges), and each
// paid run leaves one `generation_attempt` row, which the daily cap counts.
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
  isNull,
  lt,
  lte,
  ne,
  not,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { generation } from "../schema/generation";
import { generationAttempt } from "../schema/generation-attempt";
import { pullRequest } from "../schema/pull-request";
import { resolveScope, ScopeViolationError, type RowScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import {
  addQueueJob,
  buildJobPayload,
  getRecoveryJobKey,
  MAX_GENERATION_ATTEMPTS,
  readQueueJob,
} from "./queue";
import { sanitizeErrorDetail } from "logging";
import { traceStore } from "./trace-store";
import {
  ChargeOutcomes,
  ClaimOutcomes,
  GenerationKinds,
  JobKeyModes,
  type GenerationFailure,
  type GrantRowId,
  type PullRequestRowId,
} from "../types";
import {
  GenerationStatuses,
  QueueTasks,
  type GenerationPhase,
  type Result,
  type ValueOf,
} from "types";

export type GenerationRow = typeof generation.$inferSelect;

/** Where the PR's queued `generate` job stands, judged by the database clock. */
export interface GenerateJobTiming {
  readonly startsLater: boolean;
  readonly locked: boolean;
}

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
}

export interface RecoveryJobInput {
  /** After the lease, by the same database clock. */
  readonly delaySeconds: number;
  /** The url-box job's credential reference, as the claiming job carries it. */
  readonly grantId?: GrantRowId;
}

export interface ChargeRunInput extends CapWindow {
  readonly target: GenerationTarget;
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
      readonly kind: typeof ClaimOutcomes.HELD;
      /** Until the holder's lease lapses, by the database clock. */
      readonly leaseRemainingMs: number;
    }
  | { readonly kind: typeof ClaimOutcomes.CAPPED; readonly startedRuns: number }
  | { readonly kind: typeof ClaimOutcomes.FINISHED }
  | { readonly kind: typeof ClaimOutcomes.EXHAUSTED; readonly claims: number };

/** How a claimed run ends. */
export type RunOutcome =
  | { readonly status: typeof GenerationStatuses.SUCCEEDED }
  | { readonly status: typeof GenerationStatuses.SUPERSEDED }
  | {
      readonly status: typeof GenerationStatuses.FAILED;
      readonly failure: GenerationFailure;
    };

export interface ProjectedGeneration {
  readonly row: GenerationRow;
  /** A live run holds the row, so the projection left every column as stored. */
  readonly held: boolean;
}

// ---------------------------------------------------------------------------
// Errors: expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const GenerationErrorCodes = {
  /** The row is held by another run, by none when a holder was named, or is gone. */
  CLAIM_LOST: "claim-lost",
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
   * otherwise returns `claim-lost`.
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
   * Reflect `failed` with a typed failure, on a row no live lease holds. Any
   * `detail` param is sanitized HERE (`sanitizeErrorDetail`: first line, URLs
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
   * The daily spend cap's counter for the WHOLE instance: the
   * `generation_attempt` rows started in the half-open window `[from, to)`.
   * One row per paid run, graphile retries included, kept whatever the
   * projection row later becomes. Counted ACROSS repos, tenants and scope
   * worlds: the operator pays one bill whichever door spends it.
   */
  countStartedRuns(input: {
    readonly from: Date;
    readonly to: Date;
  }): Promise<number>;
  /**
   * Claim the row in one transaction that reads it `FOR UPDATE`; with `cap`
   * set, under the instance advisory lock, so the cap is exact across slots
   * and processes (a ceiling, not fair share). `finished` on a succeeded row,
   * `held` under a live lease, `exhausted` after `MAX_GENERATION_ATTEMPTS`
   * claims since a trigger projected it, `capped` at the cap; otherwise a run
   * id, a lease of `leaseMs` on the database clock, `running`, one more claim,
   * one attempt row and, with `recovery`, the head's recovery job. A row that
   * is gone is `claim-lost`: nobody holds a claim on it.
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
  /** The row's claim, judged by the database clock; `undefined` when absent. */
  readClaim(target: GenerationTarget): Promise<GenerationClaim | undefined>;
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
  /** The holder hands the row back `pending`; its attempt row stays, it was paid. */
  releaseClaim(
    target: GenerationTarget,
    runId: string,
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
    pickedUpAt: Date,
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
   * Only rows last written at or before `pickedUpAt` and held by no live
   * lease are taken: a head triggered after pickup may be one the run never
   * saw. Returns the number of rows swept.
   */
  supersedeStaleBriefs(
    pullRequestId: PullRequestRowId,
    currentHeadSha: string,
    pickedUpAt: Date,
  ): Promise<number>;
  /**
   * The queued `generate` job for one PR in ctx's scope; `undefined` when the
   * queue holds none. Both answers are computed in SQL, so no `run_at` value
   * leaves the database and no process clock is compared with it.
   */
  getGenerateJobTiming(
    pullRequestId: PullRequestRowId,
  ): Promise<GenerateJobTiming | undefined>;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

const INSTANCE_CAP_LOCK_KEY = "generation-cap";

async function countStartedRuns(
  executor: GenerationExecutor,
  { from, to }: { from: Date; to: Date },
): Promise<number> {
  // Deliberately UNSCOPED, the one cross-world aggregate in this store. The
  // daily cap is spend protection for the INSTANCE: every started run
  // counts, whichever repo or door paid for it. Only a count leaves.
  const rows = await executor
    .select({ total: count() })
    .from(generationAttempt)
    .where(
      and(
        gte(generationAttempt.startedAt, from),
        lt(generationAttempt.startedAt, to),
      ),
    );
  return rows[0]?.total ?? 0;
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

/** A run holds the row and its lease has not lapsed, by the database clock. */
function isLeaseLive(): SQL {
  return sql`(${generation.runId} is not null and ${generation.leaseExpiresAt} > now())`;
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
function isProjectionHeld(): SQL {
  return sql`(${isLeaseLive()} or (${generation.runId} is null and ${generation.status} = ${GenerationStatuses.RUNNING}))`;
}

function keepWhileHeld(column: PgColumn, reset: SQL | string | null): SQL {
  return sql`case when ${isProjectionHeld()} then ${column} else ${reset} end`;
}

const CLAIM_CLEARED = { runId: null, leaseExpiresAt: null } as const;

const TERMINAL_CLEARED = {
  ...CLAIM_CLEARED,
  phase: null,
  errorCode: null,
  errorParams: null,
} as const;

/**
 * The pending projection both ingest and the worker write. First call inserts
 * (`attempts = 0`); a re-queue of the same key conflicts (NULLS NOT DISTINCT),
 * increments `attempts` and clears `phase`, the error columns, `repo_config`
 * and the claim. A held row keeps every column, so a live run is never
 * clobbered and a dropped trigger is not a paid attempt; a `running` row whose
 * lease lapsed (a dead worker) is projected afresh.
 */
export async function projectPendingGeneration(
  executor: GenerationExecutor,
  scope: RowScope,
  target: GenerationTarget,
): Promise<ProjectedGeneration> {
  const rows = await executor
    .insert(generation)
    .values({
      installationId: scope.installationId,
      pullRequestId: target.pullRequestId,
      kind: target.kind,
      headSha: target.headSha,
      baselineSha: target.baselineSha,
      status: GenerationStatuses.PENDING,
    })
    .onConflictDoUpdate({
      target: [
        generation.installationId,
        generation.pullRequestId,
        generation.kind,
        generation.headSha,
        generation.baselineSha,
      ],
      set: {
        status: keepWhileHeld(generation.status, GenerationStatuses.PENDING),
        attempts: keepWhileHeld(
          generation.attempts,
          sql`${generation.attempts} + 1`,
        ),
        phase: keepWhileHeld(generation.phase, null),
        errorCode: keepWhileHeld(generation.errorCode, null),
        errorParams: keepWhileHeld(generation.errorParams, null),
        repoConfig: keepWhileHeld(generation.repoConfig, null),
        runId: keepWhileHeld(generation.runId, null),
        leaseExpiresAt: keepWhileHeld(generation.leaseExpiresAt, null),
        claims: keepWhileHeld(generation.claims, sql`0`),
        updatedAt: new Date(),
      },
    })
    .returning({
      ...getTableColumns(generation),
      held: sql<boolean>`${isProjectionHeld()}`,
    });
  const projected = rows[0];
  if (projected === undefined) {
    throw new Error("generation upsertPending returned no row");
  }

  const { held, ...row } = projected;
  return { row, held };
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
    return { ...shapeFailure(outcome.failure), ...CLAIM_CLEARED, phase: null };
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
      write.updatedAt = new Date();
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
      `generation ${target.kind}@${target.headSha} is held by another run or gone`,
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

  /** A transition on a row nobody holds: no claim, or one whose lease lapsed. */
  async function unclaimedTransition(
    target: GenerationTarget,
    set: GenerationSet,
  ): Promise<Result<GenerationRow, GenerationError>> {
    return transition(target, set, { guard: not(isLeaseLive()) });
  }

  async function claimRow(
    executor: GenerationExecutor,
    input: ClaimRunInput,
  ): Promise<Result<ClaimRunOutcome, GenerationError>> {
    const { target, phase, leaseMs } = input;
    const found = await executor
      .select({
        status: generation.status,
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
    if (current.leaseLive) {
      return {
        ok: true,
        value: {
          kind: ClaimOutcomes.HELD,
          leaseRemainingMs: current.leaseRemainingMs,
        },
      };
    }
    if (current.claims >= MAX_GENERATION_ATTEMPTS) {
      return {
        ok: true,
        value: { kind: ClaimOutcomes.EXHAUSTED, claims: current.claims },
      };
    }
    const startedRuns = await findCapReached(executor, input);
    if (startedRuns !== undefined) {
      return { ok: true, value: { kind: ClaimOutcomes.CAPPED, startedRuns } };
    }

    const runId = randomUUID();
    const claimed = await transition(
      target,
      {
        status: GenerationStatuses.RUNNING,
        phase: phase ?? null,
        errorCode: null,
        errorParams: null,
        runId,
        leaseExpiresAt: computeLeaseEnd(leaseMs),
        claims: sql`${generation.claims} + 1`,
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
      return unclaimedTransition(target, {
        ...TERMINAL_CLEARED,
        status: GenerationStatuses.SUPERSEDED,
      });
    },

    async markCapped(target) {
      // Same abort semantics as markSuperseded: the run never started, so
      // `attempts` stays untouched and nothing is retried.
      return unclaimedTransition(target, {
        ...TERMINAL_CLEARED,
        status: GenerationStatuses.CAPPED,
      });
    },

    async markFailed(target, failure) {
      return unclaimedTransition(target, {
        ...shapeFailure(failure),
        ...CLAIM_CLEARED,
      });
    },

    async recordRepoConfig(target, runId, repoConfig) {
      return fencedTransition(target, runId, { repoConfig });
    },

    async get(target) {
      const rows = await db
        .select()
        .from(generation)
        .where(keyWhere(target))
        .limit(1);
      return rows[0];
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

    async readClaim(target) {
      const rows = await db
        .select({
          claimed: sql<boolean>`${generation.runId} is not null`,
          leaseLive: sql<boolean>`${isLeaseLive()}`,
          leaseRemainingMs: computeLeaseRemainingMs(),
        })
        .from(generation)
        .where(keyWhere(target))
        .limit(1);
      return rows[0];
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

    async releaseClaim(target, runId) {
      return fencedTransition(target, runId, {
        ...CLAIM_CLEARED,
        status: GenerationStatuses.PENDING,
        phase: null,
      });
    },

    async settleStoredBrief(target, pickedUpAt) {
      const rows = await db
        .update(generation)
        .set({
          ...TERMINAL_CLEARED,
          status: GenerationStatuses.SUCCEEDED,
          updatedAt: new Date(),
        })
        .where(
          and(
            keyWhere(target),
            ne(generation.status, GenerationStatuses.SUCCEEDED),
            not(isProjectionHeld()),
            lte(generation.updatedAt, pickedUpAt),
          ),
        )
        .returning();
      return rows[0];
    },

    async latestBriefForPullRequests(pullRequestIds) {
      if (pullRequestIds.length === 0) {
        return new Map();
      }
      // Superseded rows sort LAST so they never shadow a live row: a swept
      // stale row carries a FRESHER updated_at than the current head's
      // success, so recency alone would report it as "the current push".
      // All-superseded (e.g. a closed PR) still falls through to the newest
      // superseded row. id DESC tiebreaks same-millisecond writes.
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
        .orderBy(
          asc(generation.pullRequestId),
          asc(sql`(${generation.status} = ${GenerationStatuses.SUPERSEDED})`),
          desc(generation.updatedAt),
          desc(generation.id),
        );
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
          updatedAt: new Date(),
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
            lte(generation.updatedAt, pickedUpAt),
            not(isLeaseLive()),
          ),
        )
        .returning({ id: generation.id });
      return rows.length;
    },

    async getGenerateJobTiming(pullRequestId) {
      const scopedPullRequest = and(
        scope.matchesPullRequest(),
        eq(pullRequest.id, pullRequestId),
      );
      const inScope = await db
        .select({ id: pullRequest.id })
        .from(pullRequest)
        .where(scopedPullRequest)
        .limit(1);
      if (inScope[0] === undefined) {
        return undefined;
      }

      const job = await readQueueJob(db, getGenerateJobKey(pullRequestId));
      if (job === undefined) {
        return undefined;
      }
      return { startsLater: job.startsLater, locked: job.locked };
    },
  });
}
