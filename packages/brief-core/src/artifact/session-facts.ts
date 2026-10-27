import {
  StoredSessionFactsReadSchema,
  StoredSessionFactsRemainderSchema,
} from "./schemas";
import type {
  BriefSessionFactsRead,
  ChunkRegion,
  FlagKey,
  StoredSessionFactsChunk,
} from "./types";
import { readStored } from "./utils";

const UNIT_REGION: ChunkRegion = { start: 1, end: 1 };

type RangedLines = Pick<
  StoredSessionFactsChunk,
  "file" | "addedRanges" | "removedRanges" | "riskSurface"
>;

/** The lines' whole diff span, the region their flags' Dispositions anchor on. */
function deriveChunkRegion(chunk: RangedLines): ChunkRegion {
  const bounds = [...chunk.addedRanges, ...chunk.removedRanges];
  if (bounds.length === 0) {
    return UNIT_REGION;
  }

  return {
    start: Math.min(...bounds.map((range) => range.start)),
    end: Math.max(...bounds.map((range) => range.end)),
  };
}

/** One flag per attribute over the lines' whole span; for an unattributed file that is the span its remainder chunk shows. */
function listFlagKeys(lines: RangedLines): FlagKey[] {
  const region = deriveChunkRegion(lines);
  return lines.riskSurface.map((attribute) => ({
    filePath: lines.file,
    attribute,
    regionStart: region.start,
    regionEnd: region.end,
  }));
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
  const remainder = unattributed.flatMap((entry) => {
    const read = StoredSessionFactsRemainderSchema.safeParse(entry);
    return read.success ? [read.data] : [];
  });
  const flags = [...chunks, ...remainder].flatMap(listFlagKeys);
  const facts = {
    chunkIds: chunks.map((chunk) => chunk.id),
    groupIds: changeGroups.map((group) => group.id),
    flags,
    filePaths: [...new Set(chunks.map((chunk) => chunk.file))],
    markableChunkCount: chunks.length + unattributed.length,
  };
  return { ok: true, value: facts };
}
