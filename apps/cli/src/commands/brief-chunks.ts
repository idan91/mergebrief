// The slice of a brief two command families read: `diff --group` filters by a
// group's chunks and `chunk-read --group` marks them.
import { ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../client";
import { CliError, ExitCodes } from "../exit";
import type { BriefSpan } from "../types";
import { buildSkewError } from "../utils";
import { buildRequestPath } from "./request-path";

const briefChunkSliceSchema = z.object({
  chunks: z.array(
    z.object({
      id: z.string(),
      changeGroupId: z.string(),
      file: z.string(),
      addedRanges: z.array(z.object({ start: z.number(), end: z.number() })),
      removedRanges: z.array(z.object({ start: z.number(), end: z.number() })),
    }),
  ),
});

export type BriefChunk = z.infer<
  typeof briefChunkSliceSchema
>["chunks"][number];

export interface BriefTarget {
  readonly repoId: string;
  readonly prNumber: number;
  readonly span: BriefSpan;
}

/** A change group's chunks in the brief at `span`; a group it lacks is not found. */
export async function readGroupChunks(
  client: ApiClient,
  { repoId, prNumber, span }: BriefTarget,
  group: string,
): Promise<BriefChunk[]> {
  const brief = await client.request({
    path: buildRequestPath(
      ProductQueryIds.READ_BRIEF,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
  });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(brief.bodyText);
  } catch {
    throw buildSkewError("brief");
  }
  const parsed = briefChunkSliceSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw buildSkewError("brief");
  }

  const chunks = parsed.data.chunks.filter(
    (chunk) => chunk.changeGroupId === group,
  );
  if (chunks.length === 0) {
    throw new CliError(
      ExitCodes.NOT_FOUND,
      `change group "${group}" is not in this PR's brief (see \`mergebrief groups ${prNumber}\`)`,
    );
  }
  return chunks;
}
