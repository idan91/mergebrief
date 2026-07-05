// The transactional ingest seam (BRIEF-2 stage 4, plan decision #1): the ONE
// write path a generation-relevant webhook takes. `triggerGeneration` runs a
// single transaction that (1) upserts the `pull_request` aggregate root,
// (2) upserts the `(kind: brief, head)` `generation` projection row as
// `queued`, and (3) enqueues graphile-worker's `generate` job by calling the
// `graphile_worker.add_job` SQL function BY NAME on the same transaction —
// graphile's documented transactional-enqueue pattern. This package never
// imports the `graphile-worker` npm package: the graphile schema and its
// `jobs` table stay graphile-owned; we only call its public SQL function.
//
// IDEMPOTENCY CONTRACT (webhook redelivery / rapid pushes): re-running the
// same trigger lands on the same `pull_request` row (natural-key upsert), the
// same `generation` row with `attempts` incremented and `phase`/`error` reset
// (NULLS NOT DISTINCT natural key, exactly `generation.ts#upsertQueued`), and
// the SAME job — `job_key = generate:{pull_request_id}` with
// `job_key_mode => 'replace'` replaces the pending job and pushes its
// `run_at` out to now + debounce, so the debounce is TRAILING: the job fires
// `debounceSeconds` after the LAST trigger, once.
//
// ERRORS: the only expected failure is a caller-supplied invalid debounce
// (mirrors `purge.ts`'s INVALID_GRACE guard). Everything else — DB down,
// missing `graphile_worker` schema — is an infra/programmer error and throws,
// rolling the whole transaction back (no partial writes, no orphaned job).
import { sql } from "drizzle-orm";
import { type AppDatabase, internal } from "./db";
import { generation } from "./schema/generation";
import { pullRequest } from "./schema/pull-request";
import type { GenerationRow } from "./generation";
import {
  lifecycleColumns,
  type PullRequestRow,
  type PullRequestUpsertInput,
  type TenantContext,
} from "./tenant";
import { GenerationKind, GenerationStatus, PrState, type Result, type ValueOf } from "./types";

const DEFAULT_DEBOUNCE_SECONDS = 60;

/**
 * SQL predicate (for use in an `ON CONFLICT DO UPDATE`): the EXISTING
 * `pull_request` row is already in a terminal (`closed`/`merged`) state.
 */
function existingPrIsTerminal() {
  return sql`${pullRequest.state} in (${PrState.CLOSED}, ${PrState.MERGED})`;
}

/** The one BRIEF-2 job kind (plan decision #1); the worker lands in BRIEF-3. */
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
// Surface.
// ---------------------------------------------------------------------------

export interface TriggerGenerationInput {
  /** The PR the event describes; a trigger carries `state: open`. */
  readonly pullRequest: PullRequestUpsertInput;
  /** The head SHA the queued brief generation targets. */
  readonly headSha: string;
  /** Trailing-debounce window; defaults to 60s (plan decision #1). */
  readonly debounceSeconds?: number;
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
  readonly generation: GenerationRow;
}

export interface IngestRoutines {
  readonly ctx: TenantContext;
  /**
   * Atomically upsert the PR row, project the brief generation as `queued`,
   * and enqueue/replace the debounced `generate` job. See the module header
   * for the idempotency contract.
   */
  triggerGeneration(input: TriggerGenerationInput): Promise<Result<IngestOutcome, IngestError>>;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/** Build the tenant-scoped ingest seam over the opaque handle. */
export function ingestRoutines(handle: AppDatabase, ctx: TenantContext): IngestRoutines {
  const db = internal(handle);
  const { installationId } = ctx;

  return {
    ctx,

    async triggerGeneration(input) {
      const debounceSeconds = input.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS;
      // Guard the primitive itself (same reasoning as `purge.ts` graceDays):
      // a negative/NaN debounce would enqueue a job that fires immediately or
      // never — no upstream validation should be trusted to catch it.
      if (!Number.isFinite(debounceSeconds) || debounceSeconds < 0) {
        return {
          ok: false,
          error: {
            code: IngestErrorCode.INVALID_DEBOUNCE,
            message: `debounceSeconds must be a non-negative finite number, got ${debounceSeconds}`,
          },
        };
      }

      return db.transaction(async (tx) => {
        // 1. Upsert the `pull_request` aggregate root — same values/onConflict
        // shape as `tenant.ts#pullRequests.upsert`, installation stamped from
        // ctx (D2b).
        const lifecycle = lifecycleColumns(input.pullRequest);
        // Preserve a terminal lifecycle unless this is an explicit `reopened`.
        // A stale/late generation trigger (redelivery, or a review on an
        // already-closed PR) writes `state: open` too, and must not resurrect a
        // closed/merged PR — so on conflict we keep the stored terminal
        // state/closed_at/purge_after via a CASE keyed on the EXISTING row's
        // state. `reopened` bypasses the guard and applies the open lifecycle.
        const preserveTerminal = input.reopen !== true;
        const prRows = await tx
          .insert(pullRequest)
          .values({
            installationId,
            repoId: input.pullRequest.repoId,
            prNumber: input.pullRequest.prNumber,
            repoSlug: input.pullRequest.repoSlug,
            ...lifecycle,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [pullRequest.installationId, pullRequest.repoId, pullRequest.prNumber],
            set: {
              repoSlug: input.pullRequest.repoSlug,
              state: preserveTerminal
                ? sql`case when ${existingPrIsTerminal()} then ${pullRequest.state} else ${lifecycle.state} end`
                : lifecycle.state,
              closedAt: preserveTerminal
                ? sql`case when ${existingPrIsTerminal()} then ${pullRequest.closedAt} else ${lifecycle.closedAt} end`
                : lifecycle.closedAt,
              purgeAfter: preserveTerminal
                ? sql`case when ${existingPrIsTerminal()} then ${pullRequest.purgeAfter} else ${lifecycle.purgeAfter} end`
                : lifecycle.purgeAfter,
              updatedAt: new Date(),
            },
          })
          .returning();
        const prRow = prRows[0];
        if (prRow === undefined) {
          throw new Error("pull_request upsert returned no row");
        }

        // 2. Project the brief generation as `queued` — replicates
        // `generation.ts#upsertQueued`'s insert/onConflict INLINE on this tx
        // (NULLS NOT DISTINCT natural key; re-queue bumps `attempts`, resets
        // `phase`/`error`). No parent-in-tenant check: the parent row was
        // written by THIS transaction one statement ago.
        const genRows = await tx
          .insert(generation)
          .values({
            installationId,
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
              error: null,
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
        // matter). Ids cross as STRINGS — JSON cannot carry bigint; the
        // BRIEF-3 worker re-brands them through `TenantContextSchema`.
        const jobKey = `generate:${prRow.id}`;
        const payloadJson = JSON.stringify({
          installation_id: String(installationId),
          pull_request_id: String(prRow.id),
          head_sha: input.headSha,
        });
        await tx.execute(sql`
          select graphile_worker.add_job(
            ${GENERATE_TASK_IDENTIFIER},
            payload => ${payloadJson}::json,
            job_key => ${jobKey},
            run_at => now() + make_interval(secs => ${debounceSeconds}),
            job_key_mode => ${"replace"}
          )
        `);

        return { ok: true, value: { pullRequest: prRow, generation: genRow } };
      });
    },
  };
}
