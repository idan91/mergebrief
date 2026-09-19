// The transactional ingest boundary, the ONE write path a generation-relevant
// webhook takes: upsert the `pull_request` root, upsert the brief `generation`
// row, enqueue graphile's `generate` job through `graphile_worker.add_job` BY
// NAME on the same transaction (graphile owns its schema; this package never
// imports it). The job key `generate:{pull_request_id}` with `preserve_run_at`
// is a LEADING-edge debounce: the first push fixes `run_at`, later pushes only
// replace the payload head, a locked job gets its key detached and a fresh
// job, and a `running` head is neither reset nor re-enqueued.
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { type AppDatabase, internal } from "../db/handle";
import { generation } from "../schema/generation";
import { pullRequest } from "../schema/pull-request";
import { getGenerateJobKey, type GenerationRow } from "./generation";
import {
  buildLifecycleColumns,
  type PullRequestRow,
  type PullRequestUpdateSet,
  type PullRequestUpsertInput,
} from "./tenant";
import { resolveScope, type RowScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import type { GenerateJobPayload, Mutable } from "types";
import {
  GenerationKinds,
  GenerationStatuses,
  PrStates,
  type GrantRowId,
  type Result,
  type ValueOf,
} from "../types";

const DEFAULT_DEBOUNCE_SECONDS = 60;

/**
 * A re-queue column: the stored value survives while the row is `running`,
 * otherwise the reset value wins. A running head is never clobbered, and a
 * dropped trigger is not a paid attempt.
 */
function keepWhileRunning(column: PgColumn, reset: SQL | string | null): SQL {
  return sql`case when ${generation.status} = ${GenerationStatuses.RUNNING} then ${column} else ${reset} end`;
}

/**
 * SQL predicate (for use in an `ON CONFLICT DO UPDATE`): the EXISTING
 * `pull_request` row is already in a terminal (`closed`/`merged`) state.
 */
function existingPrIsTerminal() {
  return sql`${pullRequest.state} in (${PrStates.CLOSED}, ${PrStates.MERGED})`;
}

/**
 * Builds the per-column chooser the lifecycle columns share: with
 * `preserveTerminal`, a column keeps its STORED value when the existing row is
 * already terminal; without it, the fresh value always wins.
 */
function buildTerminalKeeper(
  preserveTerminal: boolean,
): <T>(stored: PgColumn, fresh: T) => T | SQL {
  if (!preserveTerminal) {
    return (_stored, fresh) => fresh;
  }
  return (stored, fresh) =>
    sql`case when ${existingPrIsTerminal()} then ${stored} else ${fresh} end`;
}

const GENERATE_TASK_IDENTIFIER = "generate";

// ---------------------------------------------------------------------------
// Errors: expected failures. Programmer/infra errors still `throw`.
// ---------------------------------------------------------------------------

export const IngestErrorCodes = {
  /** `debounceSeconds` was negative or non-finite (NaN/Infinity). */
  INVALID_DEBOUNCE: "invalid-debounce",
} as const;
export type IngestErrorCode = ValueOf<typeof IngestErrorCodes>;

export interface IngestError {
  readonly code: IngestErrorCode;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// The shared PR upsert.
// ---------------------------------------------------------------------------

/**
 * The query surface the upsert needs, satisfied by both the unwrapped db and
 * a transaction client, so `triggerGeneration` (inside its tx) and
 * `recordState` (single statement, atomic on its own) share ONE upsert.
 */
type IngestExecutor = Pick<ReturnType<typeof internal>, "insert">;

/**
 * The terminal-preserving `pull_request` upsert (same values/onConflict shape
 * as `tenant.ts#pullRequests.upsert`, installation stamped from ctx).
 * With `preserveTerminal`, a `state: open` input landing on a closed/merged
 * row keeps the stored terminal lifecycle (stale redeliveries and state-only
 * events must never resurrect a terminal PR); non-lifecycle fields refresh
 * either way, with omitted optionals preserving stored values.
 */
async function upsertPullRequestRow(
  executor: IngestExecutor,
  scope: RowScope,
  input: PullRequestUpsertInput,
  preserveTerminal: boolean,
): Promise<PullRequestRow> {
  const lifecycle = buildLifecycleColumns(input);
  const keepTerminal = buildTerminalKeeper(preserveTerminal);
  const set: PullRequestUpdateSet = {
    repoSlug: input.repoSlug,
    title: input.title,
    state: keepTerminal(pullRequest.state, lifecycle.state),
    closedAt: keepTerminal(pullRequest.closedAt, lifecycle.closedAt),
    purgeAfter: keepTerminal(pullRequest.purgeAfter, lifecycle.purgeAfter),
    updatedAt: new Date(),
  };
  // Omitted (review events) preserves the stored value, since an absent key is a
  // column drizzle does not touch.
  if (input.baseSha !== undefined) {
    set.baseSha = input.baseSha;
  }
  if (input.draft !== undefined) {
    set.draft = input.draft;
  }
  if (input.authorLogin !== undefined) {
    set.authorLogin = input.authorLogin;
  }
  const insert = executor.insert(pullRequest).values({
    installationId: scope.installationId,
    ownerUserId: scope.ownerUserId,
    source: scope.source,
    repoId: input.repoId,
    prNumber: input.prNumber,
    repoSlug: input.repoSlug,
    title: input.title,
    baseSha: input.baseSha,
    draft: input.draft,
    authorLogin: input.authorLogin,
    ...lifecycle,
    updatedAt: new Date(),
  });
  // Each world conflicts on ITS natural key (see tenant.ts#upsert).
  const isOwnerWorld = scope.ownerUserId !== null;
  const worldKey = isOwnerWorld
    ? pullRequest.ownerUserId
    : pullRequest.installationId;
  const conflict: Mutable<Parameters<typeof insert.onConflictDoUpdate>[0]> = {
    target: [worldKey, pullRequest.repoId, pullRequest.prNumber],
    set,
  };
  if (isOwnerWorld) {
    conflict.targetWhere = sql`${pullRequest.installationId} is null`;
  }

  const rows = await insert.onConflictDoUpdate(conflict).returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("pull_request upsert returned no row");
  }
  return row;
}

/** The world-discriminated job payload; ids cross as STRINGS (JSON bigint). */
function buildJobPayload(
  scope: RowScope,
  grantId: GrantRowId | undefined,
  pullRequestId: bigint,
  headSha: string,
): GenerateJobPayload {
  if (scope.ownerUserId !== null) {
    if (grantId === undefined) {
      // Programmer error: an owner-scoped trigger with no credential reference
      // would enqueue a job the worker can only fail.
      throw new Error("owner-scoped triggerGeneration requires grantId");
    }

    return {
      owner_user_id: String(scope.ownerUserId),
      grant_id: String(grantId),
      pull_request_id: String(pullRequestId),
      head_sha: headSha,
    } satisfies GenerateJobPayload;
  }

  if (scope.installationId === null) {
    throw new Error("scope carries neither world");
  }

  return {
    installation_id: String(scope.installationId),
    pull_request_id: String(pullRequestId),
    head_sha: headSha,
  } satisfies GenerateJobPayload;
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
   * since every replace re-arms the debounce. A running head still gets no
   * job; the live run reads the flip itself.
   */
  readonly refreshRunAt?: boolean;
}

export interface IngestOutcome {
  readonly pullRequest: PullRequestRow;
  /**
   * Absent when the trigger landed on a PR whose terminal lifecycle was
   * preserved: nothing is projected and no job is enqueued. Present with status
   * `running` when the head is mid-run: the row was kept and no job added.
   */
  readonly generation?: GenerationRow;
}

export interface IngestRoutines {
  readonly ctx: ScopeContext;
  /**
   * Atomically upsert the PR row, project the brief generation as `pending`,
   * and enqueue/replace the debounced `generate` job. See the module header
   * for the idempotency contract.
   */
  triggerGeneration(
    input: TriggerGenerationInput,
  ): Promise<Result<IngestOutcome, IngestError>>;
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
    options?: { readonly reopen?: boolean },
  ): Promise<PullRequestRow>;
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

  return {
    ctx,

    async triggerGeneration(input) {
      const debounceSeconds = input.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS;
      // A negative/NaN debounce would enqueue a job that fires immediately or
      // never, and no upstream validation should be trusted to catch it.
      for (const [name, value] of [
        ["debounceSeconds", debounceSeconds],
        ["regenerationDebounceSeconds", input.regenerationDebounceSeconds],
      ] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
          return {
            ok: false,
            error: {
              code: IngestErrorCodes.INVALID_DEBOUNCE,
              message: `${name} must be a non-negative finite number, got ${value}`,
            },
          };
        }
      }

      return db.transaction(async (tx) => {
        // 1. A stale trigger (redelivery, review on a closed PR) writes
        // `state: open` too and must not resurrect a closed/merged PR: on
        // conflict the stored terminal lifecycle wins unless `reopened`. The
        // url-box world never preserves: its state comes from a LIVE GitHub
        // read, and briefing a merged PR is that door's primary use.
        const preserveTerminal =
          scope.ownerUserId === null && input.reopen !== true;
        const prRow = await upsertPullRequestRow(
          tx,
          scope,
          input.pullRequest,
          preserveTerminal,
        );

        // Terminal preserved → the trigger was stale. Stop here: projecting a
        // `pending` generation row and scheduling the job for a closed/merged PR
        // would leave a forever-pending row and dead work (there is nothing to
        // generate for). The PR upsert above still refreshed repo_slug.
        if (
          preserveTerminal &&
          (prRow.state === PrStates.CLOSED || prRow.state === PrStates.MERGED)
        ) {
          return { ok: true, value: { pullRequest: prRow } };
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

        // 2. Project the brief generation as `pending`, replicating
        // `generation.ts#upsertPending`'s insert/onConflict INLINE on this tx.
        // No parent-in-tenant check: the parent row was written by THIS
        // transaction one statement ago.
        const genRows = await tx
          .insert(generation)
          .values({
            installationId: scope.installationId,
            pullRequestId: prRow.id,
            kind: GenerationKinds.BRIEF,
            headSha: input.headSha,
            baselineSha: null,
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
              status: keepWhileRunning(
                generation.status,
                GenerationStatuses.PENDING,
              ),
              attempts: keepWhileRunning(
                generation.attempts,
                sql`${generation.attempts} + 1`,
              ),
              phase: keepWhileRunning(generation.phase, null),
              errorCode: keepWhileRunning(generation.errorCode, null),
              errorParams: keepWhileRunning(generation.errorParams, null),
              // A fresh attempt re-acquires repo config; stale origin data
              // from a prior drain must not survive the re-queue.
              repoConfig: keepWhileRunning(generation.repoConfig, null),
              updatedAt: new Date(),
            },
          })
          .returning();
        const genRow = genRows[0];
        if (genRow === undefined) {
          throw new Error("generation upsertPending returned no row");
        }
        // A running head is never re-enqueued, refreshRunAt included: under N
        // slots a fresh job for the same head would run beside the live one.
        // The live run re-reads draft state before its ready Entry instead.
        if (genRow.status === GenerationStatuses.RUNNING) {
          return {
            ok: true,
            value: { pullRequest: prRow, generation: genRow },
          };
        }

        // 3. Enqueue on the SAME tx via graphile's public SQL function (named
        // notation, so extra defaulted parameters in real graphile don't
        // matter). Ids cross as STRINGS, since JSON cannot carry bigint; the worker
        // re-brands them through `TenantContextSchema`.
        const jobKey = getGenerateJobKey(prRow.id);
        const payload = buildJobPayload(
          scope,
          input.grantId,
          prRow.id,
          input.headSha,
        );
        const payloadJson = JSON.stringify(payload);
        const jobKeyMode =
          input.refreshRunAt === true ? "replace" : "preserve_run_at";
        await tx.execute(sql`
          select graphile_worker.add_job(
            ${GENERATE_TASK_IDENTIFIER},
            payload => ${payloadJson}::json,
            job_key => ${jobKey},
            run_at => now() + make_interval(secs => ${effectiveDebounceSeconds}),
            job_key_mode => ${jobKeyMode}
          )
        `);

        return { ok: true, value: { pullRequest: prRow, generation: genRow } };
      });
    },

    async recordState(input, options) {
      // One statement, atomic on its own, no tx needed. Terminal-preserving
      // unless the caller explicitly marks a reopen (see the interface doc).
      return upsertPullRequestRow(db, scope, input, options?.reopen !== true);
    },
  };
}
