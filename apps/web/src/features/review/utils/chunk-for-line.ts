import type { BriefChunk } from "../../brief/types";
import type { CommentSide } from "./comments";
import { CommentSides } from "./comments";
import { getChunkRegion } from "./state";

function holdsLine(
  chunk: BriefChunk,
  side: CommentSide,
  line: number,
): boolean {
  const ranges =
    side === CommentSides.OLD ? chunk.removedRanges : chunk.addedRanges;

  return ranges.some((range) => line >= range.start && line <= range.end);
}

/**
 * The chunk of a file a line belongs to. A changed range holding the line
 * wins, so disjoint ranges cannot claim another chunk's leftover line; the
 * envelope is the fallback for context, then the nearest chunk above, then
 * the file's first. The read side and the write side both resolve through
 * here so a draft lands where the row that made it says it should.
 */
export function resolveChunkForLine(
  chunks: readonly BriefChunk[],
  file: string,
  side: CommentSide,
  line: number,
): BriefChunk | undefined {
  const inFile = chunks.filter((chunk) => chunk.file === file);
  const covering = inFile.find((chunk) => holdsLine(chunk, side, line));
  if (covering !== undefined) {
    return covering;
  }

  const envelope = inFile.find((chunk) => {
    const region = getChunkRegion(chunk);
    return line >= region.start && line <= region.end;
  });
  if (envelope !== undefined) {
    return envelope;
  }

  const preceding = inFile.filter(
    (chunk) => getChunkRegion(chunk).start <= line,
  );

  return preceding.at(-1) ?? inFile[0];
}
