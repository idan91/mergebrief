// The `generation` status-projection write helpers. `generation` is a mutable
// CQRS mirror of a worker job — NOT a queue, NOT a lock, NOT a domain entity:
// graphile-worker deletes succeeded jobs, so the web tier polls this. These
// helpers only REFLECT state (queued→running→succeeded/failed); single-flight,
// retries, and the dead-letter live in graphile, never here.
//
// The natural key is `(installation_id, pull_request_id, kind, head_sha,
// baseline_sha)` with NULLS NOT DISTINCT — `baseline_sha` is null for briefs,
// so without it every brief upsert would insert a second row instead of
// conflicting. `attempts` is incremented on re-queue; `updated_at` is bumped on
// every mutation. Like the artifact writes, `upsertQueued` verifies the parent
// `pull_request` belongs to ctx in-transaction.
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
import { type AppDatabase, internal } from "../db/handle";
import { generation } from "../schema/generation";
import { pullRequest } from "../schema/pull-request";
import type { TenantContext } from "./tenant";
import { sanitizeErrorDetail } from "logging";
import {
  GenerationKind,
  GenerationStatus,
  type GenerationFailure,
  type GenerationPhase,
  type PullRequestRowId,
  type RepoId,
  type Result,
  type ValueOf,
} from "../types";

export type GenerationRow = typeof generation.$inferSelect;

// ---------------------------------------------------------------------------
// Errors — expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const GenerationErrorCode = {
  /** `upsertQueued` named a `pull_request` that is not in ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /** A transition targeted a projection row absent from ctx's tenant. */
  NOT_FOUND: "not-found",
} as const;
export type GenerationErrorCode = ValueOf<typeof GenerationErrorCode>;

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

/** A Brief spans the whole PR — no lower-bound SHA in the projection key. */
interface BriefGenerationTarget extends BaseGenerationTarget {
  readonly kind: typeof GenerationKind.BRIEF;
  readonly baselineSha: null;
}

/**
 * Span-keyed kinds carry their lower bound: the reviewer's checkpoint SHA
 * for `delta`, the prior briefed head for `revision-narrative` — mirroring
 * each artifact's own natural key (`delta.baseline_sha`,
 * `revision_narrative.prev_head_sha`), so two narratives for the same head
 * but different prevHeads project as distinct rows, exactly like their
 * artifacts.
 */
interface SpanGenerationTarget extends BaseGenerationTarget {
  readonly kind:
    | typeof GenerationKind.DELTA
    | typeof GenerationKind.REVISION_NARRATIVE;
  readonly baselineSha: string;
}

export type GenerationTarget = BriefGenerationTarget | SpanGenerationTarget;

// ---------------------------------------------------------------------------
// Surface.
// ---------------------------------------------------------------------------

export interface GenerationProjection {
  readonly ctx: TenantContext;
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
   * Reflect `superseded` — a terminal mid-call abort because the PR head
   * advanced. An abort is NOT a failure: it leaves `attempts`
   * untouched (unlike a re-queue) and clears `phase` + error columns (like
   * `markSucceeded`), so a superseded job never consumes a retry.
   */
  markSuperseded(
    target: GenerationTarget,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `capped` — the terminal skip a repo's daily generation cap
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
   * Attach the repo-config per-file outcome table — written right after
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
   * The daily spend cap's counter: how much of ONE repo's budget the half-open
   * window `[from, to)` has already consumed.
   *
   * Counts ATTEMPTS, not rows — `sum(GREATEST(attempts, 1))` over the started
   * rows: each re-queue is another paid run against the same natural key, so
   * counting rows would let a hot PR spend a multiple of the cap. The tally can
   * slightly OVER-count and cap early; that is the safe direction here.
   *
   * "Started" = any status other than `queued` and `capped`:
   * - `queued` is excluded because the run being decided on is still `queued`
   *   at gate time, so counting it would make a cap of N behave like N−1. The
   *   known cost: a re-queued row's earlier attempts drop out of the tally
   *   until it runs again. Do NOT "fix" that by counting `queued`.
   * - `capped` is the skip itself and must never feed the counter that
   *   produced it.
   * `superseded` and `failed` DO count: they reached a provider call and spent.
   *
   * Scoped by `repo_id`, GitHub's immutable numeric id, not the slug — a repo
   * rename must not silently reset the day's count.
   */
  countStartedRunsForRepo(input: {
    readonly repoId: RepoId;
    readonly from: Date;
    readonly to: Date;
  }): Promise<number>;
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
   * ALL brief-kind projection rows for ONE PR — the per-revision
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
   * case — push B inside the debounce window swaps the job's payload
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
export function createGenerationProjection(
  handle: AppDatabase,
  ctx: TenantContext,
): GenerationProjection {
  const db = internal(handle);
  const { installationId } = ctx;

  /** Full natural-key predicate; `baseline_sha` matched with IS NULL when null. */
  function keyWhere(target: GenerationTarget) {
    return and(
      eq(generation.installationId, installationId),
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
  ): Promise<Result<GenerationRow, GenerationError>> {
    const rows = await db
      .update(generation)
      .set({ ...set, updatedAt: new Date() })
      .where(keyWhere(target))
      .returning();
    const row = rows[0];
    if (row === undefined) {
      return fail(
        GenerationErrorCode.NOT_FOUND,
        `generation ${target.kind}@${target.headSha} not found in tenant ${installationId}`,
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
              eq(pullRequest.installationId, installationId),
              eq(pullRequest.id, target.pullRequestId),
            ),
          )
          .limit(1);
        if (parents[0] === undefined) {
          return fail(
            GenerationErrorCode.PARENT_NOT_IN_TENANT,
            `pull_request ${target.pullRequestId} not in tenant ${installationId}`,
          );
        }
        const rows = await tx
          .insert(generation)
          .values({
            installationId,
            pullRequestId: target.pullRequestId,
            kind: target.kind,
            headSha: target.headSha,
            baselineSha: target.baselineSha,
            status: GenerationStatus.QUEUED,
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
              status: GenerationStatus.QUEUED,
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
        status: GenerationStatus.RUNNING,
        phase: phase ?? null,
      });
    },

    async markSucceeded(target) {
      // Terminal rows carry no `phase` — a determinate phase only describes a
      // RUNNING job; leaving the last mid-run value would misreport the row.
      return transition(target, {
        status: GenerationStatus.SUCCEEDED,
        phase: null,
        errorCode: null,
        errorParams: null,
      });
    },

    async markSuperseded(target) {
      // Not a failure, so `attempts` is deliberately left untouched and
      // the error columns are cleared. Terminal → no phase.
      return transition(target, {
        status: GenerationStatus.SUPERSEDED,
        phase: null,
        errorCode: null,
        errorParams: null,
      });
    },

    async markCapped(target) {
      // Same abort semantics as markSuperseded: the run never started, so
      // `attempts` stays untouched and nothing is retried.
      return transition(target, {
        status: GenerationStatus.CAPPED,
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
        status: GenerationStatus.FAILED,
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

    async countStartedRunsForRepo({ repoId, from, to }) {
      const rows = await db
        // GREATEST(attempts, 1): a first run carries attempts = 0 but is one
        // paid run; every increment past that is another one.
        .select({
          total: sql<number>`coalesce(sum(greatest(${generation.attempts}, 1)), 0)::int`,
        })
        .from(generation)
        .innerJoin(pullRequest, eq(pullRequest.id, generation.pullRequestId))
        .where(
          and(
            eq(generation.installationId, installationId),
            eq(pullRequest.installationId, installationId),
            eq(pullRequest.repoId, repoId),
            eq(generation.kind, GenerationKind.BRIEF),
            notInArray(generation.status, [
              GenerationStatus.QUEUED,
              GenerationStatus.CAPPED,
            ]),
            gte(generation.createdAt, from),
            lt(generation.createdAt, to),
          ),
        );
      return rows[0]?.total ?? 0;
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
            eq(generation.installationId, installationId),
            eq(generation.kind, GenerationKind.BRIEF),
            inArray(generation.pullRequestId, [...pullRequestIds]),
          ),
        )
        .orderBy(
          asc(generation.pullRequestId),
          asc(sql`(${generation.status} = ${GenerationStatus.SUPERSEDED})`),
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
            eq(generation.installationId, installationId),
            eq(generation.kind, GenerationKind.BRIEF),
            eq(generation.pullRequestId, pullRequestId),
          ),
        )
        .orderBy(asc(generation.id));
    },

    async supersedeStaleBriefs(pullRequestId, currentHeadSha) {
      const rows = await db
        .update(generation)
        .set({
          status: GenerationStatus.SUPERSEDED,
          phase: null,
          errorCode: null,
          errorParams: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(generation.installationId, installationId),
            eq(generation.pullRequestId, pullRequestId),
            eq(generation.kind, GenerationKind.BRIEF),
            ne(generation.headSha, currentHeadSha),
            inArray(generation.status, [
              GenerationStatus.QUEUED,
              GenerationStatus.RUNNING,
            ]),
          ),
        )
        .returning({ id: generation.id });
      return rows.length;
    },
  };
}
