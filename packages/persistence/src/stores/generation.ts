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
import { resolveScope, type RowScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import { sanitizeErrorDetail } from "logging";
import {
  ClaimOutcomes,
  GenerationKinds,
  type GenerationFailure,
  type PullRequestRowId,
} from "../types";
import type { Result, ValueOf } from "types/utils";
import { GenerationStatuses, type GenerationPhase } from "types/generations";

export type GenerationRow = typeof generation.$inferSelect;

/** Where the PR's queued `generate` job stands, judged by the database clock. */
export interface GenerateJobTiming {
  readonly startsLater: boolean;
  readonly locked: boolean;
}

/** The graphile job key: one queued `generate` job per PR. */
export function getGenerateJobKey(pullRequestId: PullRequestRowId): string {
  return `generate:${pullRequestId}`;
}

/** The statements a store op runs on one transaction, or the plain handle. */
type GenerationExecutor = Pick<
  AppDrizzle,
  "select" | "update" | "insert" | "execute"
>;

type GenerationSet = PgUpdateSetSource<typeof generation>;

interface TransitionOptions {
  /** Narrows the write; a row the key finds but the guard refuses is `claim-lost`. */
  readonly guard?: SQL;
  readonly executor?: GenerationExecutor;
}

export interface StartRunInput {
  readonly target: GenerationTarget;
  readonly phase?: GenerationPhase;
  /** Absent skips the count and the lock: the run is marked outright. */
  readonly cap?: number;
  readonly from: Date;
  readonly to: Date;
}

export type StartRunOutcome =
  | { readonly started: true; readonly createdAt: Date }
  | { readonly started: false; readonly startedRuns: number };

export interface ClaimRunInput extends StartRunInput {
  readonly leaseMs: number;
}

export type ClaimRunOutcome =
  | {
      readonly kind: typeof ClaimOutcomes.CLAIMED;
      readonly runId: string;
      /** The row's first enqueue, the queue-wait fallback for a job-less run. */
      readonly createdAt: Date;
    }
  | { readonly kind: typeof ClaimOutcomes.HELD }
  | { readonly kind: typeof ClaimOutcomes.CAPPED; readonly startedRuns: number }
  | { readonly kind: typeof ClaimOutcomes.FINISHED };

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
  /** `upsertPending` named a `pull_request` that is not in ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /** A transition targeted a projection row absent from ctx's tenant. */
  NOT_FOUND: "not-found",
  /** The row is held by another run, or by none when a holder was named. */
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
   * projection SQL ingest shares. Verifies the parent PR is in ctx's tenant.
   */
  upsertPending(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** Reflect `running`, optionally with a determinate `phase`. */
  markRunning(
    target: GenerationTarget,
    phase?: GenerationPhase,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** Reflect `succeeded`; clears `phase` and the error columns (terminal rows carry neither). */
  markSucceeded(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `superseded`, a terminal mid-call abort because the PR head
   * advanced. An abort is NOT a failure: it leaves `attempts`
   * untouched (unlike a re-queue) and clears `phase` + error columns (like
   * `markSucceeded`), so a superseded job never consumes a retry. Like every
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
   * Attach the repo-config per-file outcome table, written right after
   * acquisition, BEFORE generation, so failed and superseded
   * runs still carry `invalid`/`over-budget`/`fetch-failed` outcomes. A
   * re-queue clears it (the fresh attempt re-acquires).
   */
  recordRepoConfig(
    target: GenerationTarget,
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
   * Start a run under the daily cap: count started runs and, while
   * `started < cap`, mark the target `running` and record its attempt in the
   * SAME transaction under `pg_advisory_xact_lock(hashtext('generation-cap'))`.
   * The one lock serializes every start on the instance across every slot
   * and every worker process, so the cap is exact rather than
   * `cap + slots - 1`; a busy repo can spend the day for the others, a
   * ceiling, not fair share. Refusal leaves the row untouched and reports the
   * count that refused it. Takes no claim.
   */
  startRun(
    input: StartRunInput,
  ): Promise<Result<StartRunOutcome, GenerationError>>;
  /**
   * Claim the row for one run, in one transaction that reads it `FOR UPDATE`
   * (under the instance cap lock when `cap` is set). `finished` on a
   * succeeded row, `held` while another run's lease is live, `capped` with
   * the count at the cap; otherwise a fresh run id, a lease of `leaseMs` on
   * the database clock, status `running` and one attempt row.
   */
  claimRun(
    input: ClaimRunInput,
  ): Promise<Result<ClaimRunOutcome, GenerationError>>;
  /** The holder moves its phase; `claim-lost` for any other run id. */
  advanceRun(
    target: GenerationTarget,
    runId: string,
    phase: GenerationPhase,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** The holder pushes its lease to `now() + leaseMs`. */
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
   * A rerun found the Brief already stored: a `failed` row no live lease
   * holds becomes `succeeded`. Takes no claim; any other row is left alone
   * and `undefined` comes back.
   */
  settleStoredBrief(
    target: GenerationTarget,
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

/**
 * What the projection keeps as it is: a live lease, or a `running` row with no
 * claim, which a run started through `startRun` (or by the previous release's
 * worker) leaves behind.
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
    const rows = await executor
      .update(generation)
      .set({ ...set, updatedAt: new Date() })
      .where(and(keyWhere(target), options.guard))
      .returning();
    const row = rows[0];
    if (row !== undefined) {
      return { ok: true, value: row };
    }

    if (options.guard !== undefined) {
      const found = await executor
        .select({ id: generation.id })
        .from(generation)
        .where(keyWhere(target))
        .limit(1);
      if (found[0] !== undefined) {
        return fail(
          GenerationErrorCodes.CLAIM_LOST,
          `generation ${target.kind}@${target.headSha} is not held by this run`,
        );
      }
    }
    return failNotFound(target);
  }

  function failNotFound(
    target: GenerationTarget,
  ): Result<never, GenerationError> {
    return fail(
      GenerationErrorCodes.NOT_FOUND,
      `generation ${target.kind}@${target.headSha} not found in ${scope.label}`,
    );
  }

  /** A transition only the claim holder may make. */
  async function fencedTransition(
    target: GenerationTarget,
    runId: string,
    set: GenerationSet,
  ): Promise<Result<GenerationRow, GenerationError>> {
    return transition(target, set, { guard: eq(generation.runId, runId) });
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
    const { target, phase, cap, from, to, leaseMs } = input;
    const found = await executor
      .select({
        status: generation.status,
        leaseLive: sql<boolean>`${isLeaseLive()}`,
      })
      .from(generation)
      .where(keyWhere(target))
      .limit(1)
      .for("update");
    const current = found[0];
    if (current === undefined) {
      return failNotFound(target);
    }
    if (current.status === GenerationStatuses.SUCCEEDED) {
      return { ok: true, value: { kind: ClaimOutcomes.FINISHED } };
    }
    if (current.leaseLive) {
      return { ok: true, value: { kind: ClaimOutcomes.HELD } };
    }
    if (cap !== undefined) {
      const started = await countStartedRuns(executor, { from, to });
      if (started >= cap) {
        return {
          ok: true,
          value: { kind: ClaimOutcomes.CAPPED, startedRuns: started },
        };
      }
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
      },
      { executor },
    );
    if (!claimed.ok) {
      return claimed;
    }
    await recordAttempt(executor, scope, claimed.value.id, runId);
    return {
      ok: true,
      value: {
        kind: ClaimOutcomes.CLAIMED,
        runId,
        createdAt: claimed.value.createdAt,
      },
    };
  }

  return {
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
          return fail(
            GenerationErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${target.pullRequestId} not in ${scope.label}`,
          );
        }
        const projected = await projectPendingGeneration(tx, scope, target);
        return { ok: true, value: projected.row };
      });
    },

    async markRunning(target, phase) {
      return transition(target, {
        status: GenerationStatuses.RUNNING,
        phase: phase ?? null,
      });
    },

    async markSucceeded(target) {
      // Terminal rows carry no `phase`, since a determinate phase only describes a
      // RUNNING job; leaving the last mid-run value would misreport the row.
      return transition(target, {
        status: GenerationStatuses.SUCCEEDED,
        phase: null,
        errorCode: null,
        errorParams: null,
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

    async recordRepoConfig(target, repoConfig) {
      return transition(target, { repoConfig });
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

    async startRun({ target, phase, cap, from, to }) {
      return db.transaction(async (tx) => {
        if (cap !== undefined) {
          await lockInstanceCap(tx);
          const started = await countStartedRuns(tx, { from, to });
          if (started >= cap) {
            return {
              ok: true,
              value: { started: false, startedRuns: started },
            };
          }
        }

        const marked = await transition(
          target,
          { status: GenerationStatuses.RUNNING, phase: phase ?? null },
          { executor: tx },
        );
        if (!marked.ok) {
          return marked;
        }
        await recordAttempt(tx, scope, marked.value.id, randomUUID());
        return {
          ok: true,
          value: { started: true, createdAt: marked.value.createdAt },
        };
      });
    },

    async claimRun(input) {
      return db.transaction(async (tx) => {
        if (input.cap !== undefined) {
          await lockInstanceCap(tx);
        }
        return claimRow(tx, input);
      });
    },

    async advanceRun(target, runId, phase) {
      return fencedTransition(target, runId, {
        status: GenerationStatuses.RUNNING,
        phase,
      });
    },

    async renewLease(target, runId, leaseMs) {
      return fencedTransition(target, runId, {
        leaseExpiresAt: computeLeaseEnd(leaseMs),
      });
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

    async settleStoredBrief(target) {
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
            eq(generation.status, GenerationStatuses.FAILED),
            not(isLeaseLive()),
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
      const jobKey = getGenerateJobKey(pullRequestId);
      const rows = await db
        .select({
          startsLater: sql<boolean>`job.run_at > now()`,
          locked: sql<boolean>`job.locked_at is not null`,
        })
        .from(pullRequest)
        .innerJoin(sql`graphile_worker.jobs as job`, sql`job.key = ${jobKey}`)
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .limit(1);
      return rows[0];
    },
  };
}
