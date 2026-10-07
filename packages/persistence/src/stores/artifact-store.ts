// The `ArtifactStore`: the ONLY write path for the six immutable artifact
// tables, bound to one scope `ctx` like `createTenantRepository`. It unwraps
// `AppDatabase` with the in-package `internal()`, never re-exported. Every
// write is an `ON CONFLICT (natural_key) DO UPDATE` on a UNIQUE NULLS NOT
// DISTINCT key leading with `installation_id`, and resolves the parent
// `pull_request` in scope in the same transaction: a foreign parent is a
// Result error, never a write. `revision_narrative` also resolves its `brief`
// in (ctx, same PR); `comparison_marks` and `hunk_span` bodies are strict Zod.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { readBriefSessionFacts } from "brief-core/artifact";
import { z } from "zod/v4";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { brief } from "../schema/brief";
import { comparisonMarks } from "../schema/comparison-marks";
import { delta } from "../schema/delta";
import { diffSnapshot } from "../schema/diff-snapshot";
import { hunkSpan } from "../schema/hunk-span";
import { pullRequest } from "../schema/pull-request";
import { revisionNarrative } from "../schema/revision-narrative";
import { resolveScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import type { BriefRowId, PullRequestRowId } from "../types";
import type { Result, ValueOf } from "types/utils";

// ---------------------------------------------------------------------------
// Errors: expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const ArtifactErrorCodes = {
  /** A write named a `pull_request` that is not in ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /** A `revision_narrative` write named a `brief` not in (ctx, same PR). */
  BRIEF_NOT_ANCHORED: "brief-not-anchored",
  /** A `comparison_marks` or `hunk_span` body failed its coordinates-only Zod schema. */
  INVALID_BODY: "invalid-body",
} as const;
export type ArtifactErrorCode = ValueOf<typeof ArtifactErrorCodes>;

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
// comparison_marks body: coordinates-only, strict.
// ---------------------------------------------------------------------------

/**
 * A contiguous inclusive line run mirroring the CLI's `LineRange`: 1-based,
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

/** Per-file marks: coordinates only, never line content. */
const marksFileSchema = z
  .object({
    file: z.string(),
    addedRanges: z.array(lineRangeSchema),
    removedRanges: z.array(lineRangeSchema),
  })
  .strict();

/**
 * The persisted `comparison_marks` body: exactly `{baselineSha, headSha,
 * files[]}`. `.strict()` at every level REJECTS the CLI's read-time context
 * (`baselineLabel`, `baselineIndex`) and any per-line content key: the marks
 * content is a pure function of the SHA pair, and the
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
// hunk_span body: the paired `@@` coordinates, one entry per file.
// ---------------------------------------------------------------------------

/**
 * One `@@ -old,+new @@` header, both sides as (start, line count). Zero is
 * legal on either side: a created file reads `@@ -0,0 +1,n @@`.
 */
const hunkSchema = z
  .object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
  })
  .strict();

/**
 * The persisted `hunk_span` body. `.strict()` at every level is what keeps the
 * hop coordinates-only: a per-line content key cannot be smuggled in, which is
 * why the table needs no `persist_baseline_snapshot` gate.
 */
export const HunkSpansSchema = z.array(
  z.object({ file: z.string(), hunks: z.array(hunkSchema) }).strict(),
);
export type HunkSpans = z.infer<typeof HunkSpansSchema>;

/**
 * A JSON `string[]` id column as stored (`carried_chunk_ids`,
 * `used_group_ids`): rows predating a column are NULL, and garbage fails
 * the parse rather than passing through.
 */
export const StoredIdsSchema = z
  .string()
  .transform((raw): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })
  .pipe(z.array(z.string()));

// ---------------------------------------------------------------------------
// Row + write-input shapes.
// ---------------------------------------------------------------------------

export type BriefRow = typeof brief.$inferSelect;

/** Lean brief listing row: span/index metadata only, never the body. */
export interface BriefSpanRow {
  readonly id: BriefRowId;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headIndex: number;
  /** Row creation timestamp, the revision's briefed-at moment. */
  readonly createdAt: Date;
}

/**
 * Lean comparison-span listing row: the natural-key SHA pair only, never the
 * body (marks / delta). Feeds the PR-meta per-revision availability join: one
 * listing per kind, existence derived in memory.
 */
export interface ComparisonSpanRow {
  readonly baselineSha: string;
  readonly headSha: string;
}

/**
 * Lean narrative-span listing row: the prevHead/head pair only, never the
 * body.
 */
export interface NarrativeSpanRow {
  readonly prevHeadSha: string;
  readonly headSha: string;
}
export type DeltaRow = typeof delta.$inferSelect;
export type DiffSnapshotRow = typeof diffSnapshot.$inferSelect;
export type RevisionNarrativeRow = typeof revisionNarrative.$inferSelect;
export type ComparisonMarksRow = typeof comparisonMarks.$inferSelect;
export type HunkSpanRow = typeof hunkSpan.$inferSelect;

/** Origin trio surfaced on the Receipt. */
export interface Origin {
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
}

interface BodyVersionStamp {
  /** Omitted stores NULL on a rewrite too: a stale stamp must not outlive its body. */
  readonly bodyVersion?: number;
}

export interface BriefWriteInput extends Origin, BodyVersionStamp {
  readonly pullRequestId: PullRequestRowId;
  /** PR-base SHA, the whole-PR span's lower bound. */
  readonly baseSha: string;
  readonly headSha: string;
  /** Per-distinct-head display index. */
  readonly headIndex: number;
  readonly commitCount: number;
  readonly body: string;
  /**
   * Repo-config origin + policy snapshot JSON. The worker serializes it; this
   * layer stores it opaquely like `body`. Omit for generations that never ran
   * the repo-config phase.
   */
  readonly repoConfig?: string;
  /**
   * Anchor origin: 'anchored' | 'fresh-restart' | 'none', DB-enforced. Omit
   * only for writers predating the stamp; the worker always stamps.
   */
  readonly anchorState?: string;
  /** Fresh-restart reason ('model-swap'); only with anchorState 'fresh-restart'. */
  readonly anchorReason?: string;
  /**
   * The chunk ids carried from the previous Brief, stored as JSON. Empty for
   * a fresh restart; omit only for writers predating the stamp.
   */
  readonly carriedChunkIds?: readonly string[];
  /**
   * Every group id the PR's Brief chain has used, this Brief included,
   * stored as JSON. Omit only for writers predating the stamp.
   */
  readonly usedGroupIds?: readonly string[];
}

export interface DeltaWriteInput extends Origin, BodyVersionStamp {
  readonly pullRequestId: PullRequestRowId;
  /** Checkpoint baseline: a prior head at last submit. */
  readonly baselineSha: string;
  readonly headSha: string;
  readonly body: string;
}

export interface DiffSnapshotWriteInput {
  readonly pullRequestId: PullRequestRowId;
  /** A checkpoint SHA. */
  readonly sha: string;
  readonly body: string;
}

export interface RevisionNarrativeWriteInput extends Origin, BodyVersionStamp {
  readonly pullRequestId: PullRequestRowId;
  /** The anchoring `brief` row; verified in-tenant + same-PR. */
  readonly briefId: BriefRowId;
  /** Prior briefed head, the third SHA role. */
  readonly prevHeadSha: string;
  readonly headSha: string;
  readonly body: string;
}

export interface HunkSpanWriteInput {
  readonly pullRequestId: PullRequestRowId;
  /** The previous Brief's head. */
  readonly baselineSha: string;
  readonly headSha: string;
  /**
   * The `@@` coordinates, validated with `HunkSpansSchema`. Typed `unknown`
   * because this is the boundary that rejects anything content-bearing.
   */
  readonly spans: unknown;
}

export interface ComparisonMarksWriteInput {
  readonly pullRequestId: PullRequestRowId;
  /**
   * The marks payload, validated with `ComparisonMarksBodySchema`. Typed
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
   * All briefs on a PR, ordered by `headIndex` ascending: the worker's
   * DB-mode stand-in for the CLI manifest: next index = max + 1, previous
   * briefed head = the highest-index row whose head differs. Deliberately a
   * LEAN projection (key/index columns only, never `body`): the caller wants
   * span metadata, and a long-lived PR can hold many multi-hundred-KB bodies.
   */
  listForPullRequest(pullRequestId: PullRequestRowId): Promise<BriefSpanRow[]>;
  /**
   * The LATEST brief (highest `head_index`) per PR, batched for the list and
   * PR-meta endpoints' "current span" derivation. Lean rows (never `body`);
   * PRs with no brief are simply absent from the map.
   */
  latestForPullRequests(
    pullRequestIds: readonly PullRequestRowId[],
  ): Promise<ReadonlyMap<PullRequestRowId, BriefSpanRow>>;
  /**
   * Lean read of ONE span's repo-config snapshot: the brief-context
   * endpoint's backing query. Never loads `body` (multi-hundred-KB).
   * `undefined` = no brief row for the span; `null` = the row exists but
   * recorded no snapshot.
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
  /** Lean availability probe: never loads the body. */
  existsForSpan(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<boolean>;
  /**
   * All delta spans on a PR: the SHA pair only, never the body. One query
   * backs the per-revision lastReview join; existence is derived in memory,
   * never one probe per revision.
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
  /** Lean availability probe: never loads the body. */
  existsForSpan(
    pullRequestId: PullRequestRowId,
    prevHeadSha: string,
    headSha: string,
  ): Promise<boolean>;
  /**
   * All narrative spans on a PR: the prevHead/head pair only, never the
   * body. One query backs the per-revision previousBrief narrative join.
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
  /** Lean availability probe: never loads the body. */
  existsForSpan(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<boolean>;
  /**
   * All marks spans on a PR: the SHA pair only, never the body. One query
   * backs BOTH per-revision joins (previousBrief marks, lastReview marks);
   * existence is derived in memory, never one probe per revision.
   */
  listForPullRequest(
    pullRequestId: PullRequestRowId,
  ): Promise<ComparisonSpanRow[]>;
}

export interface HunkSpanStore {
  write(input: HunkSpanWriteInput): Promise<Result<HunkSpanRow, ArtifactError>>;
  /**
   * Every hop on a PR, full rows, ordered by row id: insertion order, NOT
   * chain order (a re-generated span keeps its original id). A chain links
   * `baseline_sha → head_sha` along consecutive brief heads, never by position
   * or by every row matching a baseline: rows FORK on a shared baseline when a
   * head's generation failed after its hop. A pair with no row enters the
   * chain as `undefined`, never skipped: skipping it passes anchors through
   * onto post-push line numbers.
   */
  listForPullRequest(pullRequestId: PullRequestRowId): Promise<HunkSpanRow[]>;
}

export interface ArtifactStore {
  readonly ctx: ScopeContext;
  readonly briefs: BriefStore;
  readonly deltas: DeltaStore;
  readonly diffSnapshots: DiffSnapshotStore;
  readonly revisionNarratives: RevisionNarrativeStore;
  readonly comparisonMarks: ComparisonMarksStore;
  readonly hunkSpans: HunkSpanStore;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

function byteSize(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

/** The `brief` columns a review session's record limits read. */
interface SessionRecordCounts {
  readonly sessionChunkCount: number | null;
  readonly sessionGroupCount: number | null;
  readonly sessionFlagCount: number | null;
}

function deriveSessionRecordCounts(body: string): SessionRecordCounts {
  const read = readBriefSessionFacts(body);
  if (!read.ok) {
    return {
      sessionChunkCount: null,
      sessionGroupCount: null,
      sessionFlagCount: null,
    };
  }
  return {
    sessionChunkCount: read.value.markableChunkCount,
    sessionGroupCount: read.value.groupIds.length,
    sessionFlagCount: read.value.flags.length,
  };
}

type Tx = Parameters<Parameters<AppDrizzle["transaction"]>[0]>[0];

/**
 * Build a tenant-scoped `ArtifactStore` over the opaque `AppDatabase`.
 * Constructed alongside `createTenantRepository`; same containment rules: `ctx` is the one
 * place an `installation_id` enters.
 */
export function createArtifactStore(
  handle: AppDatabase,
  ctx: ScopeContext,
): ArtifactStore {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  /** The parent PR is resolved within ctx's tenant BEFORE any write. */
  async function parentInTenant(
    tx: Tx,
    pullRequestId: PullRequestRowId,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: pullRequest.id })
      .from(pullRequest)
      .where(and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)))
      .limit(1);
    return rows[0] !== undefined;
  }

  const briefs: BriefStore = {
    async write(input) {
      const serializedChunkIds =
        input.carriedChunkIds === undefined
          ? null
          : JSON.stringify(input.carriedChunkIds);
      const serializedGroupIds =
        input.usedGroupIds === undefined
          ? null
          : JSON.stringify(input.usedGroupIds);
      const recordCounts = deriveSessionRecordCounts(input.body);
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in ${scope.label}`,
          );
        }
        const rows = await tx
          .insert(brief)
          .values({
            installationId: scope.installationId,
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
            carriedChunkIds: serializedChunkIds,
            usedGroupIds: serializedGroupIds,
            bodyVersion: input.bodyVersion ?? null,
            ...recordCounts,
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
              carriedChunkIds: serializedChunkIds,
              usedGroupIds: serializedGroupIds,
              bodyVersion: input.bodyVersion ?? null,
              ...recordCounts,
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
            scope.matchesChild(brief.installationId, brief.pullRequestId),
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
            scope.matchesChild(brief.installationId, brief.pullRequestId),
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
            scope.matchesChild(brief.installationId, brief.pullRequestId),
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
            scope.matchesChild(brief.installationId, brief.pullRequestId),
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
            ArtifactErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in ${scope.label}`,
          );
        }
        const rows = await tx
          .insert(delta)
          .values({
            installationId: scope.installationId,
            pullRequestId: input.pullRequestId,
            baselineSha: input.baselineSha,
            headSha: input.headSha,
            provider: input.provider,
            model: input.model,
            effort: input.effort,
            body: input.body,
            byteSize: byteSize(input.body),
            bodyVersion: input.bodyVersion ?? null,
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
              bodyVersion: input.bodyVersion ?? null,
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
            scope.matchesChild(delta.installationId, delta.pullRequestId),
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
            scope.matchesChild(delta.installationId, delta.pullRequestId),
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
            scope.matchesChild(delta.installationId, delta.pullRequestId),
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
            ArtifactErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in ${scope.label}`,
          );
        }
        const rows = await tx
          .insert(diffSnapshot)
          .values({
            installationId: scope.installationId,
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
            scope.matchesChild(
              diffSnapshot.installationId,
              diffSnapshot.pullRequestId,
            ),
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
            ArtifactErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in ${scope.label}`,
          );
        }
        // Anchoring: the brief must belong to (ctx, same PR).
        const anchors = await tx
          .select({ id: brief.id })
          .from(brief)
          .where(
            and(
              scope.matchesChild(brief.installationId, brief.pullRequestId),
              eq(brief.id, input.briefId),
              eq(brief.pullRequestId, input.pullRequestId),
            ),
          )
          .limit(1);
        if (anchors[0] === undefined) {
          return fail(
            ArtifactErrorCodes.BRIEF_NOT_ANCHORED,
            `brief ${input.briefId} not in ${scope.label} on pull_request ${input.pullRequestId}`,
          );
        }
        const rows = await tx
          .insert(revisionNarrative)
          .values({
            installationId: scope.installationId,
            pullRequestId: input.pullRequestId,
            briefId: input.briefId,
            prevHeadSha: input.prevHeadSha,
            headSha: input.headSha,
            provider: input.provider,
            model: input.model,
            effort: input.effort,
            body: input.body,
            byteSize: byteSize(input.body),
            bodyVersion: input.bodyVersion ?? null,
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
              bodyVersion: input.bodyVersion ?? null,
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
            scope.matchesChild(
              revisionNarrative.installationId,
              revisionNarrative.pullRequestId,
            ),
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
            scope.matchesChild(
              revisionNarrative.installationId,
              revisionNarrative.pullRequestId,
            ),
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
            scope.matchesChild(
              revisionNarrative.installationId,
              revisionNarrative.pullRequestId,
            ),
            eq(revisionNarrative.pullRequestId, pullRequestId),
          ),
        );
    },
  };

  const comparisonMarksStore: ComparisonMarksStore = {
    async write(input) {
      const parsed = ComparisonMarksBodySchema.safeParse(input.marks);
      if (!parsed.success) {
        return fail(ArtifactErrorCodes.INVALID_BODY, parsed.error.message);
      }
      const marks = parsed.data;
      // The natural-key SHAs ARE the body's SHA pair.
      const serialized = JSON.stringify(marks);
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in ${scope.label}`,
          );
        }
        const rows = await tx
          .insert(comparisonMarks)
          .values({
            installationId: scope.installationId,
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
            scope.matchesChild(
              comparisonMarks.installationId,
              comparisonMarks.pullRequestId,
            ),
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
            scope.matchesChild(
              comparisonMarks.installationId,
              comparisonMarks.pullRequestId,
            ),
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
            scope.matchesChild(
              comparisonMarks.installationId,
              comparisonMarks.pullRequestId,
            ),
            eq(comparisonMarks.pullRequestId, pullRequestId),
          ),
        );
    },
  };

  const hunkSpans: HunkSpanStore = {
    async write(input) {
      const parsed = HunkSpansSchema.safeParse(input.spans);
      if (!parsed.success) {
        return fail(ArtifactErrorCodes.INVALID_BODY, parsed.error.message);
      }
      const serialized = JSON.stringify(parsed.data);
      return db.transaction(async (tx) => {
        if (!(await parentInTenant(tx, input.pullRequestId))) {
          return fail(
            ArtifactErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in ${scope.label}`,
          );
        }
        const rows = await tx
          .insert(hunkSpan)
          .values({
            installationId: scope.installationId,
            pullRequestId: input.pullRequestId,
            baselineSha: input.baselineSha,
            headSha: input.headSha,
            spans: serialized,
          })
          .onConflictDoUpdate({
            target: [
              hunkSpan.installationId,
              hunkSpan.pullRequestId,
              hunkSpan.baselineSha,
              hunkSpan.headSha,
            ],
            set: { spans: serialized },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("hunk_span write returned no row");
        }
        return { ok: true, value: row };
      });
    },

    async listForPullRequest(pullRequestId) {
      return db
        .select()
        .from(hunkSpan)
        .where(
          and(
            scope.matchesChild(hunkSpan.installationId, hunkSpan.pullRequestId),
            eq(hunkSpan.pullRequestId, pullRequestId),
          ),
        )
        .orderBy(asc(hunkSpan.id));
    },
  };

  return {
    ctx,
    briefs,
    deltas,
    diffSnapshots,
    revisionNarratives,
    comparisonMarks: comparisonMarksStore,
    hunkSpans,
  };
}
