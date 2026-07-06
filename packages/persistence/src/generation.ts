// The `generation` status-projection write helpers (ADR 0018 D10). `generation`
// is a mutable CQRS mirror of a worker job — NOT a queue, NOT a lock, NOT a
// domain entity: graphile-worker deletes succeeded jobs, so the web tier polls
// this. These helpers only REFLECT state (queued→running→succeeded/failed);
// single-flight, retries, and the dead-letter live in graphile, never here.
//
// The natural key is `(installation_id, pull_request_id, kind, head_sha,
// baseline_sha)` with NULLS NOT DISTINCT — `baseline_sha` is null for briefs,
// so without it every brief upsert would insert a second row instead of
// conflicting. `attempts` is incremented on re-queue; `updated_at` is bumped on
// every mutation. Like the artifact writes, `upsertQueued` verifies the parent
// `pull_request` belongs to ctx in-transaction (stage-3 invariant (a)).
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { type AppDatabase, internal } from "./db";
import { generation } from "./schema/generation";
import { pullRequest } from "./schema/pull-request";
import type { TenantContext } from "./tenant";
import {
  GenerationKind,
  GenerationStatus,
  type GenerationPhase,
  type PullRequestRowId,
  type Result,
  type ValueOf,
} from "./types";

export type GenerationRow = typeof generation.$inferSelect;

// ---------------------------------------------------------------------------
// Error sanitization — the boundary is enforced HERE, not by the caller.
// ---------------------------------------------------------------------------

const URL_SHAPED = /\w+:\/\/\S+/g;
const MAX_ERROR_LENGTH = 300;

/**
 * Sanitize a raw error message for the `generation.error` column. Applied
 * unconditionally inside `markFailed` so callers cannot bypass it:
 * (a) first line only — drops stack traces;
 * (b) URL-shaped substrings redacted — a connection string with credentials
 *     (`postgres://user:pass@host/db`) is the realistic leak;
 * (c) capped at 300 chars.
 * Exported so callers can preview what will be stored.
 */
export function sanitizeGenerationError(raw: string): string {
  const firstLine = raw.split("\n", 1)[0] ?? "";
  const redacted = firstLine.replace(URL_SHAPED, "[redacted-url]");
  return redacted.slice(0, MAX_ERROR_LENGTH);
}

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

function fail(code: GenerationErrorCode, message: string): Result<never, GenerationError> {
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
  readonly kind: typeof GenerationKind.DELTA | typeof GenerationKind.REVISION_NARRATIVE;
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
   * resetting `phase`/`error`. Verifies the parent PR is in ctx's tenant.
   */
  upsertQueued(target: GenerationTarget): Promise<Result<GenerationRow, GenerationError>>;
  /** Reflect `running`, optionally with a determinate `phase`. */
  markRunning(
    target: GenerationTarget,
    phase?: GenerationPhase,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** Reflect `succeeded`; clears `phase` and `error` (terminal rows carry neither). */
  markSucceeded(target: GenerationTarget): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `superseded` — a terminal mid-call abort because the PR head
   * advanced (ADR 0006 #6). An abort is NOT a failure: it leaves `attempts`
   * untouched (unlike a re-queue) and clears `phase`/`error` (like
   * `markSucceeded`), so a superseded job never consumes a retry.
   */
  markSuperseded(target: GenerationTarget): Promise<Result<GenerationRow, GenerationError>>;
  /**
   * Reflect `failed`. The raw error is passed as-is; `markFailed` applies
   * `sanitizeGenerationError` itself (first line, URLs redacted, 300-char
   * cap), so callers cannot store an unsanitized reason.
   */
  markFailed(
    target: GenerationTarget,
    error: string,
  ): Promise<Result<GenerationRow, GenerationError>>;
  /** Tenant-scoped read of the projection row; absence is `undefined`. */
  get(target: GenerationTarget): Promise<GenerationRow | undefined>;
  /**
   * The NEWEST brief-kind projection per PR (by `updated_at`), batched for
   * the BRIEF-19 list/PR-meta endpoints: its `head_sha` IS the current push,
   * its status drives the wait UX. Span kinds (`delta`,
   * `revision-narrative`) never shadow it; PRs with no brief-kind row are
   * absent from the map.
   */
  latestBriefForPullRequests(
    pullRequestIds: readonly PullRequestRowId[],
  ): Promise<ReadonlyMap<PullRequestRowId, GenerationRow>>;
  /**
   * Terminalize STALE brief projections after a newer head succeeded: any
   * brief-kind row on the PR whose head differs and is still non-terminal
   * (`queued`/`running`) becomes `superseded`. Covers the pre-drain replace
   * case — push B inside the debounce window swaps the job's payload
   * (`job_key_mode => 'replace'`), so no worker run ever carries head A and
   * its queued row would otherwise sit non-terminal forever. Same abort
   * semantics as `markSuperseded` (attempts untouched, phase/error cleared).
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
export function generationProjection(handle: AppDatabase, ctx: TenantContext): GenerationProjection {
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
              error: null,
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
      return transition(target, { status: GenerationStatus.RUNNING, phase: phase ?? null });
    },

    async markSucceeded(target) {
      // Terminal rows carry no `phase` — a determinate phase only describes a
      // RUNNING job; leaving the last mid-run value would misreport the row.
      return transition(target, { status: GenerationStatus.SUCCEEDED, phase: null, error: null });
    },

    async markSuperseded(target) {
      // Abort-on-supersession (ADR 0006 #6): not a failure, so `attempts` is
      // deliberately left untouched and `error` is cleared. Terminal → no phase.
      return transition(target, { status: GenerationStatus.SUPERSEDED, phase: null, error: null });
    },

    async markFailed(target, error) {
      return transition(target, {
        status: GenerationStatus.FAILED,
        error: sanitizeGenerationError(error),
      });
    },

    async get(target) {
      const rows = await db.select().from(generation).where(keyWhere(target)).limit(1);
      return rows[0];
    },

    async latestBriefForPullRequests(pullRequestIds) {
      if (pullRequestIds.length === 0) {
        return new Map();
      }
      // DISTINCT ON (pull_request_id), superseded rows LAST, then updated_at
      // DESC (id DESC tiebreak for same-millisecond writes) → one newest
      // LIVE brief-kind row per PR. Superseded must never shadow a live row:
      // `supersedeStaleBriefs` stamps swept STALE rows with a fresher
      // updated_at than the current head's success, and a drained abort's
      // markSuperseded likewise postdates the superseding push's queued row.
      // Ordering by recency alone reported those stale rows as "the current
      // push" — permanently, for the sweep case. All-superseded (e.g. a
      // closed PR) still falls through to the newest superseded row.
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

    async supersedeStaleBriefs(pullRequestId, currentHeadSha) {
      const rows = await db
        .update(generation)
        .set({
          status: GenerationStatus.SUPERSEDED,
          phase: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(generation.installationId, installationId),
            eq(generation.pullRequestId, pullRequestId),
            eq(generation.kind, GenerationKind.BRIEF),
            ne(generation.headSha, currentHeadSha),
            inArray(generation.status, [GenerationStatus.QUEUED, GenerationStatus.RUNNING]),
          ),
        )
        .returning({ id: generation.id });
      return rows.length;
    },
  };
}
