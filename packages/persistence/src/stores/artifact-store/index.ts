// The `ArtifactStore`: the ONLY write path for the five span artifact
// tables, bound to one scope `ctx` like `createTenantRepository`. It unwraps
// `AppDatabase` with the in-package `internal()`, never re-exported. Every
// table reads and writes through one `SpanArtifactAccess`, which owns the
// scope filter, the scope stamp and the in-transaction parent check; a store
// here names only its table, its columns and its own body rules.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { traceStore } from "../trace-store";
import { readBriefSessionFacts } from "brief-core/artifact";
import { type AppDatabase, internal } from "../../db/handle";
import { brief } from "../../schema/brief";
import { comparisonMarks } from "../../schema/comparison-marks";
import { delta } from "../../schema/delta";
import { hunkSpan } from "../../schema/hunk-span";
import { revisionNarrative } from "../../schema/revision-narrative";
import { resolveScope, ScopeViolationError } from "../scope";
import type { ScopeContext } from "../scope-context";
import type { BriefRowId, PullRequestRowId } from "../../types";
import { ComparisonMarksBodySchema, HunkSpansSchema } from "./schemas";
import { createSpanArtifactAccess, type Tx } from "./span-artifact";
import type {
  ArtifactStore,
  BriefStore,
  BriefWriteInput,
  ComparisonMarksStore,
  DeltaStore,
  HunkSpanStore,
  Origin,
  RevisionNarrativeStore,
} from "./types";

/**
 * A `comparison_marks` or `hunk_span` body failed its coordinates-only Zod
 * schema: a writer defect against a fixed shape, which no retry can fix.
 */
export class InvalidArtifactBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArtifactBodyError";
  }
}

function measureByteSize(body: string): number {
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

interface BodyInput extends Origin {
  readonly body: string;
  readonly bodyVersion: number;
}

/** The origin trio, the body with its size, and the version stamp. */
function shapeBodyColumns(input: BodyInput) {
  return {
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    body: input.body,
    byteSize: measureByteSize(input.body),
    bodyVersion: input.bodyVersion,
  };
}

/** Every `brief` column past the natural key; a rewrite replaces all of them. */
function shapeBriefColumns(input: BriefWriteInput) {
  return {
    headIndex: input.headIndex,
    commitCount: input.commitCount,
    ...shapeBodyColumns(input),
    repoConfig: input.repoConfig ?? null,
    anchorState: input.anchorState ?? null,
    anchorReason: input.anchorReason ?? null,
    carriedChunkIds:
      input.carriedChunkIds === undefined ? null : [...input.carriedChunkIds],
    usedGroupIds: [...input.usedGroupIds],
    ...deriveSessionRecordCounts(input.body),
  };
}

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
  const briefSpans = createSpanArtifactAccess(db, scope, brief, brief.baseSha);
  const deltaSpans = createSpanArtifactAccess(
    db,
    scope,
    delta,
    delta.baselineSha,
  );
  const narrativeSpans = createSpanArtifactAccess(
    db,
    scope,
    revisionNarrative,
    revisionNarrative.prevHeadSha,
  );
  const marksSpans = createSpanArtifactAccess(
    db,
    scope,
    comparisonMarks,
    comparisonMarks.baselineSha,
  );
  const hopSpans = createSpanArtifactAccess(
    db,
    scope,
    hunkSpan,
    hunkSpan.baselineSha,
  );

  /** The anchoring brief must belong to (ctx, same PR). */
  async function assertBriefAnchored(
    tx: Tx,
    pullRequestId: PullRequestRowId,
    briefId: BriefRowId,
  ): Promise<void> {
    const anchoringBrief = and(
      scope.matchesChild(brief.installationId, brief.pullRequestId),
      eq(brief.id, briefId),
      eq(brief.pullRequestId, pullRequestId),
    );
    const anchors = await tx
      .select({ id: brief.id })
      .from(brief)
      .where(anchoringBrief)
      .limit(1);
    if (anchors[0] === undefined) {
      throw new ScopeViolationError(
        "brief",
        briefId,
        `${scope.label} on pull_request ${pullRequestId}`,
      );
    }
  }

  const briefs: BriefStore = {
    async write(input) {
      const columns = shapeBriefColumns(input);
      return briefSpans.write({
        pullRequestId: input.pullRequestId,
        values: {
          pullRequestId: input.pullRequestId,
          baseSha: input.baseSha,
          headSha: input.headSha,
          ...columns,
        },
        set: columns,
      });
    },

    get(pullRequestId, baseSha, headSha) {
      return briefSpans.get(
        { pullRequestId, lowerSha: baseSha, headSha },
        db.select().from(brief).$dynamic(),
      );
    },

    async getRepoConfig(pullRequestId, baseSha, headSha) {
      const row = await briefSpans.get(
        { pullRequestId, lowerSha: baseSha, headSha },
        db.select({ repoConfig: brief.repoConfig }).from(brief).$dynamic(),
      );
      return row === undefined ? undefined : row.repoConfig;
    },

    listForPullRequest(pullRequestId) {
      return briefSpans.list(
        pullRequestId,
        db
          .select({
            id: brief.id,
            baseSha: brief.baseSha,
            headSha: brief.headSha,
            headIndex: brief.headIndex,
            createdAt: brief.createdAt,
          })
          .from(brief)
          .$dynamic(),
        brief.headIndex,
      );
    },

    async latestForPullRequests(pullRequestIds) {
      if (pullRequestIds.length === 0) {
        return new Map();
      }
      // DISTINCT ON (pull_request_id) + head_index DESC → one newest-brief row
      // per PR in a single query (never the body).
      const scopedBriefs = and(
        scope.matchesChild(brief.installationId, brief.pullRequestId),
        inArray(brief.pullRequestId, [...pullRequestIds]),
      );
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
        .where(scopedBriefs)
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
      const columns = shapeBodyColumns(input);
      return deltaSpans.write({
        pullRequestId: input.pullRequestId,
        values: {
          pullRequestId: input.pullRequestId,
          baselineSha: input.baselineSha,
          headSha: input.headSha,
          ...columns,
        },
        set: columns,
      });
    },

    get(pullRequestId, baselineSha, headSha) {
      return deltaSpans.get(
        { pullRequestId, lowerSha: baselineSha, headSha },
        db.select().from(delta).$dynamic(),
      );
    },

    listForPullRequest(pullRequestId) {
      return deltaSpans.list(
        pullRequestId,
        db
          .select({ baselineSha: delta.baselineSha, headSha: delta.headSha })
          .from(delta)
          .$dynamic(),
      );
    },
  };

  const revisionNarratives: RevisionNarrativeStore = {
    async write(input) {
      const columns = { briefId: input.briefId, ...shapeBodyColumns(input) };
      return narrativeSpans.write({
        pullRequestId: input.pullRequestId,
        values: {
          pullRequestId: input.pullRequestId,
          prevHeadSha: input.prevHeadSha,
          headSha: input.headSha,
          ...columns,
        },
        set: columns,
        assertAnchorInScope: (tx) =>
          assertBriefAnchored(tx, input.pullRequestId, input.briefId),
      });
    },

    get(pullRequestId, prevHeadSha, headSha) {
      return narrativeSpans.get(
        { pullRequestId, lowerSha: prevHeadSha, headSha },
        db.select().from(revisionNarrative).$dynamic(),
      );
    },

    listForPullRequest(pullRequestId) {
      return narrativeSpans.list(
        pullRequestId,
        db
          .select({
            prevHeadSha: revisionNarrative.prevHeadSha,
            headSha: revisionNarrative.headSha,
          })
          .from(revisionNarrative)
          .$dynamic(),
      );
    },
  };

  const comparisonMarksStore: ComparisonMarksStore = {
    async write(input) {
      const parsed = ComparisonMarksBodySchema.safeParse(input.marks);
      if (!parsed.success) {
        throw new InvalidArtifactBodyError(parsed.error.message);
      }

      // The natural-key SHAs ARE the body's SHA pair.
      const marks = parsed.data;
      const serialized = JSON.stringify(marks);
      const columns = {
        body: serialized,
        byteSize: measureByteSize(serialized),
      };
      return marksSpans.write({
        pullRequestId: input.pullRequestId,
        values: {
          pullRequestId: input.pullRequestId,
          baselineSha: marks.baselineSha,
          headSha: marks.headSha,
          ...columns,
        },
        set: columns,
      });
    },

    get(pullRequestId, baselineSha, headSha) {
      return marksSpans.get(
        { pullRequestId, lowerSha: baselineSha, headSha },
        db.select().from(comparisonMarks).$dynamic(),
      );
    },

    listForPullRequest(pullRequestId) {
      return marksSpans.list(
        pullRequestId,
        db
          .select({
            baselineSha: comparisonMarks.baselineSha,
            headSha: comparisonMarks.headSha,
          })
          .from(comparisonMarks)
          .$dynamic(),
      );
    },
  };

  const hunkSpans: HunkSpanStore = {
    async write(input) {
      const parsed = HunkSpansSchema.safeParse(input.spans);
      if (!parsed.success) {
        throw new InvalidArtifactBodyError(parsed.error.message);
      }

      const columns = { spans: JSON.stringify(parsed.data) };
      return hopSpans.write({
        pullRequestId: input.pullRequestId,
        values: {
          pullRequestId: input.pullRequestId,
          baselineSha: input.baselineSha,
          headSha: input.headSha,
          ...columns,
        },
        set: columns,
      });
    },

    listForPullRequest(pullRequestId) {
      return hopSpans.list(
        pullRequestId,
        db.select().from(hunkSpan).$dynamic(),
        asc(hunkSpan.id),
      );
    },
  };

  return {
    ctx,
    briefs: traceStore("briefs", briefs),
    deltas: traceStore("deltas", deltas),
    revisionNarratives: traceStore("revisionNarratives", revisionNarratives),
    comparisonMarks: traceStore("comparisonMarks", comparisonMarksStore),
    hunkSpans: traceStore("hunkSpans", hunkSpans),
  };
}
