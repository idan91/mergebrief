// The `chunk_layout` store: one sidecar per brief row. The brief write
// replaces it in the brief's own transaction (`replaceChunkLayout`), so a
// rewritten brief never keeps the previous run's counts; `backfill` writes one
// for a brief stored without one and never replaces a sidecar already there.
// The anchoring brief is verified in scope and on the same PR inside the
// backfill's transaction, which is also the parent check.
import { and, eq, getTableColumns, type SQL } from "drizzle-orm";
import { ChunkLayoutBodySchema } from "brief-core/artifact";
import type { AppDrizzle } from "../../db/handle";
import { brief } from "../../schema/brief";
import { chunkLayout } from "../../schema/chunk-layout";
import type { BriefRowId, PullRequestRowId } from "../../types";
import type { RowScope } from "../scope";
import { InvalidArtifactBodyError } from "./errors";
import type { Tx } from "../../db/handle";
import type { ChunkLayoutRow, ChunkLayoutStore } from "./types";

export type AssertBriefAnchored = (
  tx: Tx,
  pullRequestId: PullRequestRowId,
  briefId: BriefRowId,
) => Promise<void>;

/** A checked sidecar body, serialized, with its stored size. */
export interface ChunkLayoutColumns {
  readonly body: string;
  readonly byteSize: number;
}

/** The brief whose sidecar a write replaces, already resolved in scope. */
export interface ChunkLayoutOwner {
  readonly pullRequestId: PullRequestRowId;
  readonly briefId: BriefRowId;
}

function shapeRow(row: typeof chunkLayout.$inferSelect): ChunkLayoutRow {
  return {
    id: row.id,
    briefId: row.briefId,
    body: row.body,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
  };
}

/** Parses before any transaction opens, so a refused body writes nothing. */
export function shapeChunkLayoutColumns(body: unknown): ChunkLayoutColumns {
  const parsed = ChunkLayoutBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidArtifactBodyError(parsed.error.message);
  }
  const text = JSON.stringify(parsed.data);
  return { body: text, byteSize: Buffer.byteLength(text, "utf8") };
}

/**
 * Inside the brief write's transaction: drops the brief's sidecar and, when
 * the write carries counts, stores them in its place.
 */
export async function replaceChunkLayout(
  tx: Tx,
  scope: RowScope,
  owner: ChunkLayoutOwner,
  columns: ChunkLayoutColumns | undefined,
): Promise<void> {
  const ownSidecar = and(
    scope.matchesChild(chunkLayout.installationId, chunkLayout.pullRequestId),
    eq(chunkLayout.briefId, owner.briefId),
  );
  await tx.delete(chunkLayout).where(ownSidecar);
  if (columns === undefined) {
    return;
  }

  await tx.insert(chunkLayout).values({
    installationId: scope.installationId,
    pullRequestId: owner.pullRequestId,
    briefId: owner.briefId,
    ...columns,
  });
}

export function createChunkLayoutStore(
  db: AppDrizzle,
  scope: RowScope,
  assertBriefAnchored: AssertBriefAnchored,
): ChunkLayoutStore {
  function matchesInScope(): SQL {
    return scope.matchesChild(
      chunkLayout.installationId,
      chunkLayout.pullRequestId,
    );
  }

  return {
    async backfill(input) {
      const columns = shapeChunkLayoutColumns(input.body);

      return db.transaction(async (tx) => {
        await assertBriefAnchored(tx, input.pullRequestId, input.briefId);
        const rows = await tx
          .insert(chunkLayout)
          .values({
            installationId: scope.installationId,
            pullRequestId: input.pullRequestId,
            briefId: input.briefId,
            ...columns,
          })
          .onConflictDoNothing({ target: chunkLayout.briefId })
          .returning({ id: chunkLayout.id });
        return rows.length > 0;
      });
    },

    async has(briefId) {
      const ownSidecar = and(
        matchesInScope(),
        eq(chunkLayout.briefId, briefId),
      );
      const rows = await db
        .select({ id: chunkLayout.id })
        .from(chunkLayout)
        .where(ownSidecar)
        .limit(1);
      return rows.length > 0;
    },

    async get(pullRequestId, baseSha, headSha) {
      const onSpan = and(
        matchesInScope(),
        eq(brief.pullRequestId, pullRequestId),
        eq(brief.baseSha, baseSha),
        eq(brief.headSha, headSha),
      );
      const rows = await db
        .select(getTableColumns(chunkLayout))
        .from(chunkLayout)
        .innerJoin(brief, eq(brief.id, chunkLayout.briefId))
        .where(onSpan)
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : shapeRow(row);
    },
  };
}
