// The `GenerationPartStore`: a multi-call run's finished detail calls, kept
// between calls under the brief's span so a retry resumes from them. Bound to
// one scope `ctx` like `createArtifactStore`; a write verifies the parent
// `pull_request` in its own transaction and a read filters through the scope.
import type { PartKey } from "brief-core";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { type AppDatabase, internal } from "../../db/handle";
import { generationPart } from "../../schema/generation-part";
import { InvalidArtifactBodyError } from "../artifact-store";
import { assertPullRequestInScope, resolveScope } from "../scope";
import type { ScopeContext } from "../scope-context";
import { traceStore } from "../trace-store";
import {
  GenerationPartBodySchema,
  GenerationPartKeySchema,
  type GenerationPartBody,
} from "./schemas";
import type {
  GenerationPartRow,
  GenerationPartStore,
  GenerationSpan,
} from "./types";

const NATURAL_KEY = [
  generationPart.installationId,
  generationPart.pullRequestId,
  generationPart.baseSha,
  generationPart.headSha,
  generationPart.partKey,
];

/** A stored key parses or the writer was defective: no retry fixes it. */
function parseStoredKey(partKey: string): PartKey {
  const parsed = GenerationPartKeySchema.safeParse(partKey);
  if (!parsed.success) {
    throw new InvalidArtifactBodyError("generation_part key is not a part key");
  }
  return parsed.data;
}

/** A stored body parses or the writer was defective: no retry fixes it. */
function parseStoredBody(body: string): GenerationPartBody {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new InvalidArtifactBodyError("generation_part body is not JSON");
  }
  const parsed = GenerationPartBodySchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidArtifactBodyError(parsed.error.message);
  }
  return parsed.data;
}

function shapeRow(row: typeof generationPart.$inferSelect): GenerationPartRow {
  return {
    id: row.id,
    partKey: parseStoredKey(row.partKey),
    body: parseStoredBody(row.body),
    byteSize: row.byteSize,
    createdAt: row.createdAt,
  };
}

export function createGenerationPartStore(
  handle: AppDatabase,
  ctx: ScopeContext,
): GenerationPartStore {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  function matchesSpan(span: GenerationSpan): SQL {
    const inScope = scope.matchesChild(
      generationPart.installationId,
      generationPart.pullRequestId,
    );
    const onSpan = and(
      inScope,
      eq(generationPart.pullRequestId, span.pullRequestId),
      eq(generationPart.baseSha, span.baseSha),
      eq(generationPart.headSha, span.headSha),
    );
    return onSpan ?? inScope;
  }

  const store: GenerationPartStore = {
    async write(input) {
      const key = GenerationPartKeySchema.safeParse(input.partKey);
      if (!key.success) {
        throw new Error("generation_part key is not a part key");
      }
      const parsed = GenerationPartBodySchema.safeParse(input.body);
      if (!parsed.success) {
        throw new InvalidArtifactBodyError(parsed.error.message);
      }
      const body = JSON.stringify(parsed.data);
      const columns = { body, byteSize: Buffer.byteLength(body, "utf8") };

      return db.transaction(async (tx) => {
        await assertPullRequestInScope(tx, scope, input.pullRequestId);
        const rows = await tx
          .insert(generationPart)
          .values({
            installationId: scope.installationId,
            pullRequestId: input.pullRequestId,
            baseSha: input.baseSha,
            headSha: input.headSha,
            partKey: key.data,
            ...columns,
          })
          .onConflictDoUpdate({ target: NATURAL_KEY, set: columns })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("generation_part write returned no row");
        }
        return shapeRow(row);
      });
    },

    async listForSpan(span) {
      const rows = await db
        .select()
        .from(generationPart)
        .where(matchesSpan(span))
        .orderBy(asc(generationPart.id));
      return rows.map(shapeRow);
    },

    async deleteForSpan(span) {
      const deleted = await db
        .delete(generationPart)
        .where(matchesSpan(span))
        .returning({ id: generationPart.id });
      return deleted.length;
    },
  };
  return traceStore("generationParts", store);
}
