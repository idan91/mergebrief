import type { LineRange } from "brief-core/types";
import type { BriefChunk } from "../types";
import type { RiskFlag } from "./view-model";

/** One file region a Changes section covers: a narrative or delta chunk's ranges. */
export interface SectionRegion {
  file: string;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
}

function doRangesOverlap(
  left: readonly LineRange[],
  right: readonly LineRange[],
): boolean {
  return left.some((one) =>
    right.some((other) => one.start <= other.end && other.start <= one.end),
  );
}

/**
 * Added lines only: both sides number them at head. A region's removed
 * lines are numbered at its own baseline (the previous head or the
 * checkpoint) while a chunk's are numbered at the PR base, so they cannot
 * be compared, and a deletion-only region attaches no flag.
 */
function isChunkInRegion(chunk: BriefChunk, region: SectionRegion): boolean {
  if (chunk.file !== region.file) {
    return false;
  }

  return doRangesOverlap(chunk.addedRanges, region.addedRanges);
}

/**
 * The full brief's flags whose chunk shares a file and an added line with
 * the section, in the brief's flag order.
 */
export function resolveSectionFlags(
  flags: readonly RiskFlag[],
  chunks: readonly BriefChunk[],
  section: readonly SectionRegion[],
): RiskFlag[] {
  const touched = new Set(
    chunks
      .filter((chunk) =>
        section.some((region) => isChunkInRegion(chunk, region)),
      )
      .map((chunk) => chunk.id),
  );

  return flags.filter((flag) => touched.has(flag.chunkId));
}
