// The `ArtifactStore` interface (ADR 0018 D6): the typed write/read surface for the
// five immutable artifact families — `brief`, `delta`, `diff_snapshot`,
// `revision_narrative`, `comparison_marks`. Like `forTenant` it is bound to one
// tenant `ctx` and is the ONLY way this package writes those tables. It unwraps
// the opaque `AppDatabase` with the in-package `internal()` (never re-exported),
// so consumers still cannot reach a raw query handle (D2b).
//
// Every write:
//   (a) is content-addressed — `ON CONFLICT (natural_key) DO UPDATE` makes a
//       re-write of the same span rewrite the one row in place (idempotency, D6:
//       the natural UNIQUE key IS the content key, no hash column in M1);
//   (b) stamps `installation_id` from ctx AND resolves the parent
//       `pull_request` by (ctx, id) in the SAME transaction — a parent in
//       another tenant yields a Result error, never a DB write (stage-3
//       invariant (a));
//   (c) for `revision_narrative` additionally resolves the named `brief` row by
//       (ctx, same PR, id) in-transaction — the D12 anchoring rule;
//   (d) for `comparison_marks` Zod-validates the coordinates-only body and
//       REJECTS any `baselineLabel` / `baselineIndex` / per-line content key
//       (the D13 coordinates-only rule; `.strict()` schemas).
// Provenance columns (`provider`/`model`/`effort`) are written for
// `brief`/`delta`/`revision_narrative` only — `diff_snapshot` and
// `comparison_marks` are mechanical, not LLM output (D6/D13).
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { brief } from "../schema/brief";
import { comparisonMarks } from "../schema/comparison-marks";
import { delta } from "../schema/delta";
import { diffSnapshot } from "../schema/diff-snapshot";
import { pullRequest } from "../schema/pull-request";
import { revisionNarrative } from "../schema/revision-narrative";
import type { TenantContext } from "./tenant";
import {
  type BriefRowId,
  type PullRequestRowId,
  type Result,
  type ValueOf,
} from "../types";

// ---------------------------------------------------------------------------
// Errors — expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const ArtifactErrorCode = {
  /** A write named a `pull_request` that is not in ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /** A `revision_narrative` write named a `brief` not in (ctx, same PR). */
  BRIEF_NOT_ANCHORED: "brief-not-anchored",
  /** A `comparison_marks` body failed the coordinates-only Zod schema. */
  INVALID_BODY: "invalid-body",
} as const;
export type ArtifactErrorCode = ValueOf<typeof ArtifactErrorCode>;

export interface ArtifactError {
  readonly code: ArtifactErrorCode;
  readonly message: string;
}

function fail(
  code: ArtifactErrorCode,
  message: string,
): Result<never, ArtifactError> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// comparison_marks body — coordinates-only, strict (D13).
// ---------------------------------------------------------------------------

/**
 * A contiguous inclusive line run — mirrors the CLI's `LineRange`: 1-based,
 * inclusive, `start <= end`. Enforced so malformed marks (zero/negative
 * lines, inverted ranges) are rejected at the write boundary instead of
 * pushing cleanup into every reader.
 */
const lineRangeSchema = z
  .object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.end >= range.start, {
    message: "line range end must be >= start",
    path: ["end"],
  });

/** Per-file marks — coordinates only, never line content. */
const marksFileSchema = z
  .object({
    file: z.string(),
    addedRanges: z.array(lineRangeSchema),
    removedRanges: z.array(lineRangeSchema),
  })
  .strict();

/**
 * The persisted `comparison_marks` body: exactly `{baselineSha, headSha,
 * files[]}` (Stage-4 body rule). `.strict()` at every level REJECTS the CLI's
 * read-time context (`baselineLabel`, `baselineIndex`) and any per-line content
 * key — the marks content is a pure function of the SHA pair, and the
 * checkpoint-equals-prevHead re-review case would otherwise demand two rows the
 * span-only unique key forbids.
 */
export const ComparisonMarksBodySchema = z
  .object({
    baselineSha: z.string(),
    headSha: z.string(),
    files: z.array(marksFileSchema),
  })
  .strict();
export type ComparisonMarksBody = z.infer<typeof ComparisonMarksBodySchema>;

// ---------------------------------------------------------------------------
// Row + write-input shapes.
// ---------------------------------------------------------------------------

export type BriefRow = typeof brief.$inferSelect;

/** Lean brief listing row — span/index metadata only, never the body. */
export interface BriefSpanRow {
  readonly id: BriefRowId;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headIndex: number;
  /** Row creation timestamp — the revision's briefed-at moment (BRIEF-24). */
  readonly createdAt: Date;
}

/**
 * Lean comparison-span listing row — the natural-key SHA pair only, never the
 * body (marks / delta). Feeds the PR-meta per-revision availability join
 * (BRIEF-24): one listing per kind, existence derived in memory.
 */
export interface ComparisonSpanRow {
  readonly baselineSha: string;
  readonly headSha: string;
}

/**
 * Lean narrative-span listing row — the prevHead/head pair only, never the
 * body (BRIEF-24 per-revision availability join).
 */
export interface NarrativeSpanRow {
  readonly prevHeadSha: string;
  readonly headSha: string;
}
export type DeltaRow = typeof delta.$inferSelect;
export type DiffSnapshotRow = typeof diffSnapshot.$inferSelect;
export type RevisionNarrativeRow = typeof revisionNarrative.$inferSelect;
export type ComparisonMarksRow = typeof comparisonMarks.$inferSelect;

/** Provenance trio surfaced on the Receipt (D6). */
export interface Provenance {
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
}

export interface BriefWriteInput extends Provenance {
  readonly pullRequestId: PullRequestRowId;
  /** PR-base SHA — the whole-PR span's lower bound (D3). */
  readonly baseSha: string;
  readonly headSha: string;
  /** Per-distinct-head display index (ADR 0012 label). */
  readonly headIndex: number;
  readonly commitCount: number;
  readonly body: string;
  /**
   * Repo-config origin + policy snapshot JSON (ADR 0032 #8/#11) — the
   * worker serializes it; this layer stores it opaquely like `body`. Omit
   * for generations that never ran the repo-config phase.
   */
  readonly repoConfig?: string;
  /**
   * Anchor origin (BRIEF-143) — 'anchored' | 'fresh-restart' | 'none',
   * DB-enforced (migration 0016). Omit only for writers predating the stamp;
   * the worker always stamps.
   */
  readonly anchorState?: string;
  /** Fresh-restart reason ('model-swap'); only with anchorState 'fresh-restart'. */
  readonly anchorReason?: string;
}

export interface DeltaWriteInput extends Provenance {
  readonly pullRequestId: PullRequestRowId;
  /** Checkpoint baseline — a prior head at last submit (D3). */
  readonly baselineSha: string;
  readonly headSha: string;
  readonly body: string;
}

export interface DiffSnapshotWriteInput {
  readonly pullRequestId: PullRequestRowId;
  /** A checkpoint SHA (D4). */
  readonly sha: string;
  readonly body: string;
}

export interface RevisionNarrativeWriteInput extends Provenance {
  readonly pullRequestId: PullRequestRowId;
  /** The anchoring `brief` row; verified in-tenant + same-PR (D12). */
  readonly briefId: BriefRowId;
  /** Prior briefed head — the third SHA role (D12). */
  readonly prevHeadSha: string;
  readonly headSha: string;
  readonly body: string;
}

export interface ComparisonMarksWriteInput {
  readonly pullRequestId: PullRequestRowId;
  /**
   * The marks payload — validated with `ComparisonMarksBodySchema`. Typed
   * `unknown` because this is the boundary that rejects the CLI's extra keys;
   * the natural-key SHAs are taken from the validated body, not passed apart.
   */
  readonly marks: unknown;
}

// ---------------------------------------------------------------------------
// Store surface.
// ---------------------------------------------------------------------------

export interface BriefStore {
  write(input: BriefWriteInput): Promise<Result<BriefRow, ArtifactError>>;
  get(
    pullRequestId: PullRequestRowId,
    baseSha: string,
    headSha: string,
  ): Promise<BriefRow | undefined>;
  /**
   * All briefs on a PR, ordered by `headIndex` ascending — the worker's
   * DB-mode stand-in for the CLI manifest: next index = max + 1, previous
   * briefed head = the highest-index row whose head differs. Deliberately a
   * LEAN projection (key/index columns only, never `body`): the caller wants
   * span metadata, and a long-lived PR can hold many multi-hundred-KB bodies.
   */
  listForPullRequest(pullRequestId: PullRequestRowId): Promise<BriefSpanRow[]>;
  /**
   * The LATEST brief (highest `head_index`) per PR, batched for the BRIEF-19
   * list/PR-meta endpoints' "current span" derivation. Lean rows (never
   * `body`); PRs with no brief are simply absent from the map.
   */
  latestForPullRequests(
    pullRequestIds: readonly PullRequestRowId[],
  ): Promise<ReadonlyMap<PullRequestRowId, BriefSpanRow>>;
  /**
   * Lean read of ONE span's repo-config snapshot (ADR 0032 #8) — the
   * brief-context endpoint's backing query. Never loads `body` (multi-
   * hundred-KB). `undefined` = no brief row for the span; `null` = the row
   * exists but predates BRIEF-52 (or its generation recorded no snapshot).
   */
  getRepoConfig(
    pullRequestId: PullRequestRowId,
    baseSha: string,
    headSha: string,
  ): Promise<string | null | undefined>;
}

export interface DeltaStore {
  write(input: DeltaWriteInput): Promise<Result<DeltaRow, ArtifactError>>;
  get(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<DeltaRow | undefined>;
  /** Lean availability probe (BRIEF-21 PR-meta) — never loads the body. */
  existsForSpan(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<boolean>;
  /**
   * All delta spans on a PR — the SHA pair only, never the body (BRIEF-24).
   * One query backs the per-revision lastReview join; existence is derived in
   * memory, never one probe per revision.
   */
  listForPullRequest(
    pullRequestId: PullRequestRowId,
  ): Promise<ComparisonSpanRow[]>;
}

export interface DiffSnapshotStore {
  write(
    input: DiffSnapshotWriteInput,
  ): Promise<Result<DiffSnapshotRow, ArtifactError>>;
  get(
    pullRequestId: PullRequestRowId,
    sha: string,
  ): Promise<DiffSnapshotRow | undefined>;
}

export interface RevisionNarrativeStore {
  write(
    input: RevisionNarrativeWriteInput,
  ): Promise<Result<RevisionNarrativeRow, ArtifactError>>;
  get(
    pullRequestId: PullRequestRowId,
    prevHeadSha: string,
    headSha: string,
  ): Promise<RevisionNarrativeRow | undefined>;
  /** Lean availability probe (BRIEF-19 4.1) — never loads the body. */
  existsForSpan(
    pullRequestId: PullRequestRowId,
    prevHeadSha: string,
    headSha: string,
  ): Promise<boolean>;
  /**
   * All narrative spans on a PR — the prevHead/head pair only, never the body
   * (BRIEF-24). One query backs the per-revision previousBrief narrative join.
   */
  listForPullRequest(
    pullRequestId: PullRequestRowId,
  ): Promise<NarrativeSpanRow[]>;
}

export interface ComparisonMarksStore {
  write(
    input: ComparisonMarksWriteInput,
  ): Promise<Result<ComparisonMarksRow, ArtifactError>>;
  get(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<ComparisonMarksRow | undefined>;
  /** Lean availability probe (BRIEF-19 4.1) — never loads the body. */
  existsForSpan(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<boolean>;
  /**
   * All marks spans on a PR — the SHA pair only, never the body (BRIEF-24).
   * One query backs BOTH per-revision joins (previousBrief marks, lastReview
   * marks); existence is derived in memory, never one probe per revision.
   */
  listForPullRequest(
    pullRequestId: PullRequestRowId,
  ): Promise<ComparisonSpanRow[]>;
}

export interface ArtifactStore {
  readonly ctx: TenantContext;
  readonly briefs: BriefStore;
  readonly deltas: DeltaStore;
  readonly diffSnapshots: DiffSnapshotStore;
  readonly revisionNarratives: RevisionNarrativeStore;
  readonly comparisonMarks: ComparisonMarksStore;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

function byteSize(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

type Tx = Parameters<Parameters<AppDrizzle["transaction"]>[0]>[0];

/**
 * Build a tenant-scoped `ArtifactStore` over the opaque `AppDatabase`.
 * Constructed alongside `forTenant`; same containment rules — `ctx` is the one
 * place an `installation_id` enters.
 */
export function artifactStore(
  handle: AppDatabase,
  ctx: TenantContext,
): ArtifactStore {
  const db = internal(handle);
  const { installationId } = ctx;

  /** Invariant (a): parent PR resolved within ctx's tenant BEFORE any write. */
  async function parentInTenant(
    tx: Tx,
    pullRequestId: PullRequestRowId,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: pullRequest.id })
      .from(pullRequest)
      .where(
        and(
          eq(pullRequest.installationId, installationId),
          eq(pullRequest.id, pullRequestId),
        ),
      )
      .limit(1);
    return rows[0] !== undefined;
  }

  const briefs: BriefStore = {
    async write(input) {
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCode.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in tenant ${installationId}`,
          );
        }
        const rows = await tx
          .insert(brief)
          .values({
            installationId,
            pullRequestId: input.pullRequestId,
            baseSha: input.baseSha,
            headSha: input.headSha,
            headIndex: input.headIndex,
            commitCount: input.commitCount,
            provider: input.provider,
            model: input.model,
            effort: input.effort,
            body: input.body,
            byteSize: byteSize(input.body),
            repoConfig: input.repoConfig ?? null,
            anchorState: input.anchorState ?? null,
            anchorReason: input.anchorReason ?? null,
          })
          .onConflictDoUpdate({
            target: [
              brief.installationId,
              brief.pullRequestId,
              brief.baseSha,
              brief.headSha,
            ],
            set: {
              headIndex: input.headIndex,
              commitCount: input.commitCount,
              provider: input.provider,
              model: input.model,
              effort: input.effort,
              body: input.body,
              byteSize: byteSize(input.body),
              repoConfig: input.repoConfig ?? null,
              anchorState: input.anchorState ?? null,
              anchorReason: input.anchorReason ?? null,
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("brief write returned no row");
        }
        return { ok: true, value: row };
      });
    },

    async get(pullRequestId, baseSha, headSha) {
      const rows = await db
        .select()
        .from(brief)
        .where(
          and(
            eq(brief.installationId, installationId),
            eq(brief.pullRequestId, pullRequestId),
            eq(brief.baseSha, baseSha),
            eq(brief.headSha, headSha),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async getRepoConfig(pullRequestId, baseSha, headSha) {
      const rows = await db
        .select({ repoConfig: brief.repoConfig })
        .from(brief)
        .where(
          and(
            eq(brief.installationId, installationId),
            eq(brief.pullRequestId, pullRequestId),
            eq(brief.baseSha, baseSha),
            eq(brief.headSha, headSha),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : row.repoConfig;
    },

    async listForPullRequest(pullRequestId) {
      return db
        .select({
          id: brief.id,
          baseSha: brief.baseSha,
          headSha: brief.headSha,
          headIndex: brief.headIndex,
          createdAt: brief.createdAt,
        })
        .from(brief)
        .where(
          and(
            eq(brief.installationId, installationId),
            eq(brief.pullRequestId, pullRequestId),
          ),
        )
        .orderBy(brief.headIndex);
    },

    async latestForPullRequests(pullRequestIds) {
      if (pullRequestIds.length === 0) {
        return new Map();
      }
      // DISTINCT ON (pull_request_id) + head_index DESC → one newest-brief row
      // per PR in a single query (never the body).
      const rows = await db
        .selectDistinctOn([brief.pullRequestId], {
          pullRequestId: brief.pullRequestId,
          id: brief.id,
          baseSha: brief.baseSha,
          headSha: brief.headSha,
          headIndex: brief.headIndex,
          createdAt: brief.createdAt,
        })
        .from(brief)
        .where(
          and(
            eq(brief.installationId, installationId),
            inArray(brief.pullRequestId, [...pullRequestIds]),
          ),
        )
        .orderBy(asc(brief.pullRequestId), desc(brief.headIndex));
      return new Map(
        rows.map((row) => [
          row.pullRequestId,
          {
            id: row.id,
            baseSha: row.baseSha,
            headSha: row.headSha,
            headIndex: row.headIndex,
            createdAt: row.createdAt,
          },
        ]),
      );
    },
  };

  const deltas: DeltaStore = {
    async write(input) {
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCode.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in tenant ${installationId}`,
          );
        }
        const rows = await tx
          .insert(delta)
          .values({
            installationId,
            pullRequestId: input.pullRequestId,
            baselineSha: input.baselineSha,
            headSha: input.headSha,
            provider: input.provider,
            model: input.model,
            effort: input.effort,
            body: input.body,
            byteSize: byteSize(input.body),
          })
          .onConflictDoUpdate({
            target: [
              delta.installationId,
              delta.pullRequestId,
              delta.baselineSha,
              delta.headSha,
            ],
            set: {
              provider: input.provider,
              model: input.model,
              effort: input.effort,
              body: input.body,
              byteSize: byteSize(input.body),
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("delta write returned no row");
        }
        return { ok: true, value: row };
      });
    },

    async get(pullRequestId, baselineSha, headSha) {
      const rows = await db
        .select()
        .from(delta)
        .where(
          and(
            eq(delta.installationId, installationId),
            eq(delta.pullRequestId, pullRequestId),
            eq(delta.baselineSha, baselineSha),
            eq(delta.headSha, headSha),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async existsForSpan(pullRequestId, baselineSha, headSha) {
      const rows = await db
        .select({ id: delta.id })
        .from(delta)
        .where(
          and(
            eq(delta.installationId, installationId),
            eq(delta.pullRequestId, pullRequestId),
            eq(delta.baselineSha, baselineSha),
            eq(delta.headSha, headSha),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async listForPullRequest(pullRequestId) {
      return db
        .select({ baselineSha: delta.baselineSha, headSha: delta.headSha })
        .from(delta)
        .where(
          and(
            eq(delta.installationId, installationId),
            eq(delta.pullRequestId, pullRequestId),
          ),
        );
    },
  };

  const diffSnapshots: DiffSnapshotStore = {
    async write(input) {
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCode.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in tenant ${installationId}`,
          );
        }
        const rows = await tx
          .insert(diffSnapshot)
          .values({
            installationId,
            pullRequestId: input.pullRequestId,
            sha: input.sha,
            body: input.body,
            byteSize: byteSize(input.body),
          })
          .onConflictDoUpdate({
            target: [
              diffSnapshot.installationId,
              diffSnapshot.pullRequestId,
              diffSnapshot.sha,
            ],
            set: {
              body: input.body,
              byteSize: byteSize(input.body),
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("diff_snapshot write returned no row");
        }
        return { ok: true, value: row };
      });
    },

    async get(pullRequestId, sha) {
      const rows = await db
        .select()
        .from(diffSnapshot)
        .where(
          and(
            eq(diffSnapshot.installationId, installationId),
            eq(diffSnapshot.pullRequestId, pullRequestId),
            eq(diffSnapshot.sha, sha),
          ),
        )
        .limit(1);
      return rows[0];
    },
  };

  const revisionNarratives: RevisionNarrativeStore = {
    async write(input) {
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCode.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in tenant ${installationId}`,
          );
        }
        // D12 anchoring: the brief must belong to (ctx, same PR).
        const anchors = await tx
          .select({ id: brief.id })
          .from(brief)
          .where(
            and(
              eq(brief.installationId, installationId),
              eq(brief.id, input.briefId),
              eq(brief.pullRequestId, input.pullRequestId),
            ),
          )
          .limit(1);
        if (anchors[0] === undefined) {
          return fail(
            ArtifactErrorCode.BRIEF_NOT_ANCHORED,
            `brief ${input.briefId} not in tenant ${installationId} on pull_request ${input.pullRequestId}`,
          );
        }
        const rows = await tx
          .insert(revisionNarrative)
          .values({
            installationId,
            pullRequestId: input.pullRequestId,
            briefId: input.briefId,
            prevHeadSha: input.prevHeadSha,
            headSha: input.headSha,
            provider: input.provider,
            model: input.model,
            effort: input.effort,
            body: input.body,
            byteSize: byteSize(input.body),
          })
          .onConflictDoUpdate({
            target: [
              revisionNarrative.installationId,
              revisionNarrative.pullRequestId,
              revisionNarrative.prevHeadSha,
              revisionNarrative.headSha,
            ],
            set: {
              briefId: input.briefId,
              provider: input.provider,
              model: input.model,
              effort: input.effort,
              body: input.body,
              byteSize: byteSize(input.body),
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("revision_narrative write returned no row");
        }
        return { ok: true, value: row };
      });
    },

    async get(pullRequestId, prevHeadSha, headSha) {
      const rows = await db
        .select()
        .from(revisionNarrative)
        .where(
          and(
            eq(revisionNarrative.installationId, installationId),
            eq(revisionNarrative.pullRequestId, pullRequestId),
            eq(revisionNarrative.prevHeadSha, prevHeadSha),
            eq(revisionNarrative.headSha, headSha),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async existsForSpan(pullRequestId, prevHeadSha, headSha) {
      const rows = await db
        .select({ id: revisionNarrative.id })
        .from(revisionNarrative)
        .where(
          and(
            eq(revisionNarrative.installationId, installationId),
            eq(revisionNarrative.pullRequestId, pullRequestId),
            eq(revisionNarrative.prevHeadSha, prevHeadSha),
            eq(revisionNarrative.headSha, headSha),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async listForPullRequest(pullRequestId) {
      return db
        .select({
          prevHeadSha: revisionNarrative.prevHeadSha,
          headSha: revisionNarrative.headSha,
        })
        .from(revisionNarrative)
        .where(
          and(
            eq(revisionNarrative.installationId, installationId),
            eq(revisionNarrative.pullRequestId, pullRequestId),
          ),
        );
    },
  };

  const comparisonMarksStore: ComparisonMarksStore = {
    async write(input) {
      const parsed = ComparisonMarksBodySchema.safeParse(input.marks);
      if (!parsed.success) {
        return fail(ArtifactErrorCode.INVALID_BODY, parsed.error.message);
      }
      const marks = parsed.data;
      // The natural-key SHAs ARE the body's SHA pair (D13 pure-function rule).
      const serialized = JSON.stringify(marks);
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCode.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in tenant ${installationId}`,
          );
        }
        const rows = await tx
          .insert(comparisonMarks)
          .values({
            installationId,
            pullRequestId: input.pullRequestId,
            baselineSha: marks.baselineSha,
            headSha: marks.headSha,
            body: serialized,
            byteSize: byteSize(serialized),
          })
          .onConflictDoUpdate({
            target: [
              comparisonMarks.installationId,
              comparisonMarks.pullRequestId,
              comparisonMarks.baselineSha,
              comparisonMarks.headSha,
            ],
            set: {
              body: serialized,
              byteSize: byteSize(serialized),
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("comparison_marks write returned no row");
        }
        return { ok: true, value: row };
      });
    },

    async get(pullRequestId, baselineSha, headSha) {
      const rows = await db
        .select()
        .from(comparisonMarks)
        .where(
          and(
            eq(comparisonMarks.installationId, installationId),
            eq(comparisonMarks.pullRequestId, pullRequestId),
            eq(comparisonMarks.baselineSha, baselineSha),
            eq(comparisonMarks.headSha, headSha),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async existsForSpan(pullRequestId, baselineSha, headSha) {
      const rows = await db
        .select({ id: comparisonMarks.id })
        .from(comparisonMarks)
        .where(
          and(
            eq(comparisonMarks.installationId, installationId),
            eq(comparisonMarks.pullRequestId, pullRequestId),
            eq(comparisonMarks.baselineSha, baselineSha),
            eq(comparisonMarks.headSha, headSha),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async listForPullRequest(pullRequestId) {
      return db
        .select({
          baselineSha: comparisonMarks.baselineSha,
          headSha: comparisonMarks.headSha,
        })
        .from(comparisonMarks)
        .where(
          and(
            eq(comparisonMarks.installationId, installationId),
            eq(comparisonMarks.pullRequestId, pullRequestId),
          ),
        );
    },
  };

  return {
    ctx,
    briefs,
    deltas,
    diffSnapshots,
    revisionNarratives,
    comparisonMarks: comparisonMarksStore,
  };
}
