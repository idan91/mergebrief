// The `generation` status-projection write helpers: a mutable CQRS mirror of a
// worker job, never a queue, a lock or a domain entity. graphile-worker deletes
// succeeded jobs, so the web tier polls this; single-flight, retries and the
// dead-letter live in graphile. The natural key is `(installation_id,
// pull_request_id, kind, head_sha, baseline_sha)` with NULLS NOT DISTINCT,
// because `baseline_sha` is null for briefs and every brief upsert would
// otherwise insert a second row instead of conflicting.
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { generation } from "../schema/generation";
import { pullRequest } from "../schema/pull-request";
import { resolveScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import { sanitizeErrorDetail } from "logging";
import {
  GenerationKinds,
  GenerationStatuses,
  type GenerationFailure,
  type GenerationPhase,
  type PullRequestRowId,
  type RepoId,
  type Result,
  type ValueOf,
} from "../types";

export type GenerationRow = typeof generation.$inferSelect;

/** The statements `startRun` runs on one transaction, or the plain handle. */
type GenerationExecutor = Pick<AppDrizzle, "select" | "update">;

export interface StartRunInput {
  readonly target: GenerationTarget;
  readonly phase?: GenerationPhase;
  readonly repoId: RepoId;
  /** Absent skips the count and the lock: the run is marked outright. */
  readonly cap?: number;
  readonly from: Date;
  readonly to: Date;
}

export type StartRunOutcome =
  | { readonly started: true; readonly createdAt: Date }
  | { readonly started: false; readonly startedRuns: number };

// ---------------------------------------------------------------------------
// Errors: expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const GenerationErrorCodes = {
  /** `upsertQueued` named a `pull_request` that is not in ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /** A transition targeted a projection row absent from ctx's tenant. */
  NOT_FOUND: "not-found",
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
   * Project a job as `queued`. First call inserts (`attempts = 0`); a re-queue
   * of the same key conflicts (NULLS NOT DISTINCT) and increments `attempts`,
   * resetting `phase` and the error columns. Verifies the parent PR is in ctx's tenant.
   */
  upsertQueued(
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
   * `markSucceeded`), so a superseded job never consumes a retry.
   */
  markSuperseded(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `capped`, the terminal skip a repo's daily generation cap
   * produces. Like `markSuperseded` this is NOT a failure:
   * `attempts` is untouched and `phase` + error columns are cleared, so a capped run
   * consumes no retry and shows no error text.
   */
  markCapped(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `failed` with a typed failure. Any `detail` param is sanitized
   * HERE (`sanitizeErrorDetail`: first line, URLs redacted, 300-char cap),
   * so callers cannot store an unsanitized reason.
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
   * The daily spend cap's counter for ONE repo over the half-open window
   * `[from, to)`. Sums ATTEMPTS (`GREATEST(attempts, 1)`), not rows, since each
   * re-queue is another paid run on the same key. "Started" excludes `queued`
   * (the run being decided is still queued, so counting it turns cap N into
   * N-1) and `capped` (the skip must not feed the counter that produced it).
   * Keyed by `repo_id`, not the slug, and counted ACROSS scope worlds: one
   * repo has one daily budget whichever door spends it.
   */
  countStartedRunsForRepo(input: {
    readonly repoId: RepoId;
    readonly from: Date;
    readonly to: Date;
  }): Promise<number>;
  /**
   * Start a run under the daily cap: count started runs for the repo and, while
   * `started < cap`, mark the target `running` in the SAME transaction under
   * `pg_advisory_xact_lock(hashtext('generation-cap:' || repo_id))`. The lock
   * serializes starts per repo across every slot and every worker
   * process, so the cap is exact rather than `cap + slots - 1`. Refusal
   * leaves the row untouched and reports the count that refused it.
   */
  startRun(
    input: StartRunInput,
  ): Promise<Result<StartRunOutcome, GenerationError>>;
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
   * Terminalize STALE brief projections after a newer head succeeded: any
   * brief-kind row on the PR whose head differs and is still non-terminal
   * (`queued`/`running`) becomes `superseded`. Covers the pre-drain replace
   * case: push B inside the debounce window swaps the job's payload
   * (`job_key_mode => 'replace'`), so no worker run ever carries head A and
   * its queued row would otherwise sit non-terminal forever. Same abort
   * semantics as `markSuperseded` (attempts untouched, phase/errors cleared).
   * Returns the number of rows swept.
   */
  supersedeStaleBriefs(
    pullRequestId: PullRequestRowId,
    currentHeadSha: string,
  ): Promise<number>;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/** Build a tenant-scoped `generation` projection over the opaque handle. */
async function countStartedRuns(
  executor: GenerationExecutor,
  { repoId, from, to }: { repoId: RepoId; from: Date; to: Date },
): Promise<number> {
  const rows = await executor
    // GREATEST(attempts, 1): a first run carries attempts = 0 but is one
    // paid run; every increment past that is another one.
    //
    // Deliberately UNSCOPED, the one cross-world aggregate in this
    // store. The daily cap is spend protection for a REPO: every started
    // run for `repo_id` counts, whichever door paid for it, so N
    // signed-in viewers cannot each spend a full budget on one repo.
    // Only a count leaves the query; no row data crosses scopes.
    .select({
      total: sql<number>`coalesce(sum(greatest(${generation.attempts}, 1)), 0)::int`,
    })
    .from(generation)
    .innerJoin(pullRequest, eq(pullRequest.id, generation.pullRequestId))
    .where(
      and(
        eq(pullRequest.repoId, repoId),
        eq(generation.kind, GenerationKinds.BRIEF),
        notInArray(generation.status, [
          GenerationStatuses.QUEUED,
          GenerationStatuses.CAPPED,
        ]),
        gte(generation.createdAt, from),
        lt(generation.createdAt, to),
      ),
    );
  return rows[0]?.total ?? 0;
}

function shapeStart(
  marked: Result<GenerationRow, GenerationError>,
): Result<StartRunOutcome, GenerationError> {
  if (!marked.ok) {
    return marked;
  }
  return {
    ok: true,
    value: { started: true, createdAt: marked.value.createdAt },
  };
}

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
    set: Partial<typeof generation.$inferInsert>,
    executor: GenerationExecutor = db,
  ): Promise<Result<GenerationRow, GenerationError>> {
    const rows = await executor
      .update(generation)
      .set({ ...set, updatedAt: new Date() })
      .where(keyWhere(target))
      .returning();
    const row = rows[0];
    if (row === undefined) {
      return fail(
        GenerationErrorCodes.NOT_FOUND,
        `generation ${target.kind}@${target.headSha} not found in ${scope.label}`,
      );
    }
    return { ok: true, value: row };
  }

  return {
    ctx,

    async upsertQueued(target) {
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
        const rows = await tx
          .insert(generation)
          .values({
            installationId: scope.installationId,
            pullRequestId: target.pullRequestId,
            kind: target.kind,
            headSha: target.headSha,
            baselineSha: target.baselineSha,
            status: GenerationStatuses.QUEUED,
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
              status: GenerationStatuses.QUEUED,
              attempts: sql`${generation.attempts} + 1`,
              phase: null,
              errorCode: null,
              errorParams: null,
              repoConfig: null,
              updatedAt: new Date(),
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("generation upsertQueued returned no row");
        }
        return { ok: true, value: row };
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
      // Not a failure, so `attempts` is deliberately left untouched and
      // the error columns are cleared. Terminal → no phase.
      return transition(target, {
        status: GenerationStatuses.SUPERSEDED,
        phase: null,
        errorCode: null,
        errorParams: null,
      });
    },

    async markCapped(target) {
      // Same abort semantics as markSuperseded: the run never started, so
      // `attempts` stays untouched and nothing is retried.
      return transition(target, {
        status: GenerationStatuses.CAPPED,
        phase: null,
        errorCode: null,
        errorParams: null,
      });
    },

    async markFailed(target, failure) {
      // An empty sanitized detail (empty message, leading newline) drops to
      // null params so readers fall back to the code, per the sanitizer's
      // gate-on-the-result contract.
      const detail =
        "params" in failure ? sanitizeErrorDetail(failure.params.detail) : "";
      return transition(target, {
        status: GenerationStatuses.FAILED,
        errorCode: failure.code,
        errorParams: detail === "" ? null : { detail },
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

    async countStartedRunsForRepo(input) {
      return countStartedRuns(db, input);
    },

    async startRun({ target, phase, repoId, cap, from, to }) {
      const set = { status: GenerationStatuses.RUNNING, phase: phase ?? null };
      if (cap === undefined) {
        return shapeStart(await transition(target, set));
      }

      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`generation-cap:${repoId}`}))`,
        );
        const started = await countStartedRuns(tx, { repoId, from, to });
        if (started >= cap) {
          return { ok: true, value: { started: false, startedRuns: started } };
        }

        return shapeStart(await transition(target, set, tx));
      });
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

    async supersedeStaleBriefs(pullRequestId, currentHeadSha) {
      const rows = await db
        .update(generation)
        .set({
          status: GenerationStatuses.SUPERSEDED,
          phase: null,
          errorCode: null,
          errorParams: null,
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
              GenerationStatuses.QUEUED,
              GenerationStatuses.RUNNING,
            ]),
          ),
        )
        .returning({ id: generation.id });
      return rows.length;
    },
  };
}
