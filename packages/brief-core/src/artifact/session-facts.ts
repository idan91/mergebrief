import { StoredSessionFactsReadSchema } from "./schemas";
import type {
  BriefSessionFactsRead,
  ChunkRegion,
  StoredSessionFactsChunk,
} from "./types";
import { readStored } from "./utils";

const UNIT_REGION: ChunkRegion = { start: 1, end: 1 };

/** The chunk's whole diff span, the region its flags' Dispositions anchor on. */
function deriveChunkRegion(chunk: StoredSessionFactsChunk): ChunkRegion {
  const bounds = [...chunk.addedRanges, ...chunk.removedRanges];
  if (bounds.length === 0) {
    return UNIT_REGION;
  }

  return {
    start: Math.min(...bounds.map((range) => range.start)),
    end: Math.max(...bounds.map((range) => range.end)),
  };
}

/**
 * Reads only what a Review Session checks its writes and its carry-over
 * against: a lean parse of a large body, failing only on these lists.
 */
export function readBriefSessionFacts(json: string): BriefSessionFactsRead {
  const parsed = readStored(StoredSessionFactsReadSchema, json);
  if (!parsed.ok) {
    return parsed;
  }

  const { changeGroups, chunks, unattributed } = parsed.value;
  const flags = chunks.flatMap((chunk) => {
    const region = deriveChunkRegion(chunk);
    return chunk.riskSurface.map((attribute) => ({
      filePath: chunk.file,
      attribute,
      regionStart: region.start,
      regionEnd: region.end,
    }));
  });
  const facts = {
    chunkIds: chunks.map((chunk) => chunk.id),
    groupIds: changeGroups.map((group) => group.id),
    flags,
    filePaths: [...new Set(chunks.map((chunk) => chunk.file))],
    markableChunkCount: chunks.length + unattributed.length,
  };
  return { ok: true, value: facts };
}
