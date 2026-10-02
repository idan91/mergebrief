import type { TFunction } from "i18next";

import type { BriefChunk } from "../../../types";
import { splitFilePath } from "../utils";
import type { ChunkMark } from "./types";

export function getChunkStartLine(chunk: BriefChunk): number | undefined {
  return chunk.addedRanges[0]?.start ?? chunk.removedRanges[0]?.start;
}

export function deriveChunkMarks(chunks: readonly BriefChunk[]): ChunkMark[] {
  return chunks.map((chunk, index) => ({
    id: chunk.id,
    basename: splitFilePath(chunk.file).basename,
    line: getChunkStartLine(chunk),
    position: index + 1,
  }));
}

export function findMarkIndex(
  marks: readonly ChunkMark[],
  chunkId: string | undefined,
): number | undefined {
  const index = marks.findIndex((mark) => mark.id === chunkId);
  return index === -1 ? undefined : index;
}

/** Left and Right clamp at the ends; any other key is not a move. */
export function moveRovingIndex(
  key: string,
  index: number,
  count: number,
): number | undefined {
  const last = count - 1;
  if (key === "ArrowLeft") {
    return Math.max(index - 1, 0);
  }
  if (key === "ArrowRight") {
    return Math.min(index + 1, last);
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return last;
  }
  return undefined;
}

/** "params.ts line 40, chunk 2 of 5": the name a focused mark announces. */
export function deriveMarkName(
  t: TFunction,
  mark: ChunkMark,
  total: number,
): string {
  if (mark.line === undefined) {
    return t("brief.chunkStrip.markNameNoLine", {
      file: mark.basename,
      index: mark.position,
      total,
    });
  }
  return t("brief.chunkStrip.markName", {
    file: mark.basename,
    line: mark.line,
    index: mark.position,
    total,
  });
}
