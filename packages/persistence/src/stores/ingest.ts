// The transactional ingest boundary: the ONE write path a generation-relevant
// webhook takes. `triggerGeneration` runs a single transaction that
// (1) upserts the `pull_request` aggregate root, (2) upserts the
// `(kind: brief, head)` `generation` projection row as `queued`, and
// (3) enqueues graphile-worker's `generate` job by calling the
// `graphile_worker.add_job` SQL function BY NAME on the same transaction.
// This package never imports the `graphile-worker` npm package: the graphile
// schema and its `jobs` table stay graphile-owned; we only call its public SQL
// function.
//
// IDEMPOTENCY CONTRACT (webhook redelivery / rapid pushes): re-running the
// same trigger lands on the same `pull_request` row (natural-key upsert), the
// same `generation` row with `attempts` incremented and `phase`/`error` reset,
// and the SAME job — `job_key = generate:{pull_request_id}` with
// `job_key_mode => 'replace'` replaces the pending job and pushes its `run_at`
// out to now + debounce, so the debounce is TRAILING: the job fires
// `debounceSeconds` after the LAST trigger, once.
//
// ERRORS: the only expected failure is a caller-supplied invalid debounce.
// Everything else — DB down, missing `graphile_worker` schema — is an
// infra/programmer error and throws, rolling the whole transaction back (no
// partial writes, no orphaned job).
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { type AppDatabase, internal } from "../db/handle";
import { generation } from "../schema/generation";
import { pullRequest } from "../schema/pull-request";
import type { GenerationRow } from "./generation";
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
  GenerationKind,
  GenerationStatus,
  PrState,
  type GrantRowId,
  type Result,
  type ValueOf,
} from "../types";

const DEFAULT_DEBOUNCE_SECONDS = 60;

/**
 * SQL predicate (for use in an `ON CONFLICT DO UPDATE`): the EXISTING
 * `pull_request` row is already in a terminal (`closed`/`merged`) state.
 */
function existingPrIsTerminal() {
  return sql`${pullRequest.state} in (${PrState.CLOSED}, ${PrState.MERGED})`;
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
// Errors — expected failures. Programmer/infra errors still `throw`.
// ---------------------------------------------------------------------------

export const IngestErrorCode = {
  /** `debounceSeconds` was negative or non-finite (NaN/Infinity). */
  INVALID_DEBOUNCE: "invalid-debounce",
} as const;
export type IngestErrorCode = ValueOf<typeof IngestErrorCode>;

export interface IngestError {
  readonly code: IngestErrorCode;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// The shared PR upsert.
// ---------------------------------------------------------------------------

/**
 * The query surface the upsert needs — satisfied by both the unwrapped db and
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
  // Omitted (review events) preserves the stored value — an absent key is a
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
  /** The head SHA the queued brief generation targets. */
  readonly headSha: string;
  /** Trailing-debounce window; defaults to 60s. */
  readonly debounceSeconds?: number;
  /**
   * Trailing-debounce window applied INSTEAD of `debounceSeconds` when a prior
   * brief generation for this PR has SUCCEEDED (push-storm damping). The
   * condition is deliberately "a brief exists to look at":
   * queued/failed/superseded priors don't damp. Policy is the caller's; this
   * store owns only the transactional prior-success check.
   */
  readonly regenerationDebounceSeconds?: number;
  /**
   * The url-box job's credential REFERENCE — REQUIRED under an owner scope
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
   * merely IMPLIES the PR is open: if the stored row is already terminal — a
   * stale redelivery, or a review on a since-closed PR — the upsert must NOT
   * resurrect it. Defaults to false (preserve a terminal lifecycle).
   */
  readonly reopen?: boolean;
}

export interface IngestOutcome {
  readonly pullRequest: PullRequestRow;
  /**
   * Absent when the trigger landed on a PR whose terminal lifecycle was
   * preserved (stale/late trigger on a closed/merged PR): nothing is queued
   * and no job is enqueued — a brief for a terminal PR would never be read.
   */
  readonly generation?: GenerationRow;
}

export interface IngestRoutines {
  readonly ctx: ScopeContext;
  /**
   * Atomically upsert the PR row, project the brief generation as `queued`,
   * and enqueue/replace the debounced `generate` job. See the module header
   * for the idempotency contract.
   */
  triggerGeneration(
    input: TriggerGenerationInput,
  ): Promise<Result<IngestOutcome, IngestError>>;
  /**
   * Persist PR state fields through the SAME terminal-preserving upsert as
   * `triggerGeneration` — WITHOUT touching the generation projection or
   * enqueueing work. For state-only events (`converted_to_draft`) that carry
   * no regen rationale: re-triggering the worker's skip-path is not a no-op
   * (Entry-comment repost ping, compare-diff spend, phantom `queued` status,
   * and a full LLM re-run if the head's last generation failed). Terminal
   * lifecycles are preserved unless `reopen` is set — the one state-only event
   * that legitimately leaves a terminal state is a `reopened` delivery
   * arriving where policy suppresses the enqueue: without the flag the row
   * would wedge closed forever, since no later event passes through
   * `triggerGeneration`'s reopen path either.
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
      // never — no upstream validation should be trusted to catch it.
      for (const [name, value] of [
        ["debounceSeconds", debounceSeconds],
        ["regenerationDebounceSeconds", input.regenerationDebounceSeconds],
      ] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
          return {
            ok: false,
            error: {
              code: IngestErrorCode.INVALID_DEBOUNCE,
              message: `${name} must be a non-negative finite number, got ${value}`,
            },
          };
        }
      }

      return db.transaction(async (tx) => {
        // 1. Upsert the `pull_request` aggregate root. A stale/late trigger
        // (redelivery, or a review on an already-closed PR) writes
        // `state: open` too and must not resurrect a closed/merged PR, so on
        // conflict the stored terminal lifecycle is kept via a CASE keyed on
        // the EXISTING row's state. `reopened` bypasses the guard.
        // The owner (url-box) world never preserves or suppresses on a
        // terminal lifecycle: the state comes from a LIVE GitHub read at the
        // door (no stale redeliveries exist), and briefing a merged/closed PR
        // is that door's primary use.
        const preserveTerminal =
          scope.ownerUserId === null && input.reopen !== true;
        const prRow = await upsertPullRequestRow(
          tx,
          scope,
          input.pullRequest,
          preserveTerminal,
        );

        // Terminal preserved → the trigger was stale. Stop here: projecting a
        // `queued` generation row and scheduling the job for a closed/merged PR
        // would leave a forever-queued row and dead work (there is nothing to
        // generate for). The PR upsert above still refreshed repo_slug.
        if (
          preserveTerminal &&
          (prRow.state === PrState.CLOSED || prRow.state === PrState.MERGED)
        ) {
          return { ok: true, value: { pullRequest: prRow } };
        }

        // 1b. The regeneration window applies only when a prior brief for this
        // PR SUCCEEDED — checked on THIS tx so the read and the enqueue can't
        // interleave with another trigger's projection write. Must run before
        // step 2, which upserts the current head's own (queued) row.
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
                eq(generation.kind, GenerationKind.BRIEF),
                eq(generation.status, GenerationStatus.SUCCEEDED),
              ),
            )
            .limit(1);
          if (prior.length > 0) {
            effectiveDebounceSeconds = input.regenerationDebounceSeconds;
          }
        }

        // 2. Project the brief generation as `queued` — replicates
        // `generation.ts#upsertQueued`'s insert/onConflict INLINE on this tx.
        // No parent-in-tenant check: the parent row was written by THIS
        // transaction one statement ago.
        const genRows = await tx
          .insert(generation)
          .values({
            installationId: scope.installationId,
            pullRequestId: prRow.id,
            kind: GenerationKind.BRIEF,
            headSha: input.headSha,
            baselineSha: null,
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
              // A fresh attempt re-acquires repo config; stale origin data
              // from a prior drain must not survive the re-queue.
              repoConfig: null,
              updatedAt: new Date(),
            },
          })
          .returning();
        const genRow = genRows[0];
        if (genRow === undefined) {
          throw new Error("generation upsertQueued returned no row");
        }

        // 3. Enqueue on the SAME tx via graphile's public SQL function (named
        // notation, so extra defaulted parameters in real graphile don't
        // matter). Ids cross as STRINGS — JSON cannot carry bigint; the worker
        // re-brands them through `TenantContextSchema`.
        const jobKey = `generate:${prRow.id}`;
        const payload = buildJobPayload(
          scope,
          input.grantId,
          prRow.id,
          input.headSha,
        );
        const payloadJson = JSON.stringify(payload);
        await tx.execute(sql`
          select graphile_worker.add_job(
            ${GENERATE_TASK_IDENTIFIER},
            payload => ${payloadJson}::json,
            job_key => ${jobKey},
            run_at => now() + make_interval(secs => ${effectiveDebounceSeconds}),
            job_key_mode => ${"replace"}
          )
        `);

        return { ok: true, value: { pullRequest: prRow, generation: genRow } };
      });
    },

    async recordState(input, options) {
      // One statement — atomic on its own, no tx needed. Terminal-preserving
      // unless the caller explicitly marks a reopen (see the interface doc).
      return upsertPullRequestRow(db, scope, input, options?.reopen !== true);
    },
  };
}
