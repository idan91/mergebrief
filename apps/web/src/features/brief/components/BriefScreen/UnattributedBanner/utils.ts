// Closure-free helpers for the unattributed banner (directly unit-testable).
import type { BriefChunk, LineRange } from "../../../types";
import type { UnattributedFileView } from "../../../utils/viewModel";

/** Fragments beyond this collapse into an ellipsis — the expansion has them all. */
export const MAX_RANGE_FRAGMENTS = 6;

/** "5–8, 12" over the side that actually has ranges (new-side preferred). */
export function formatRanges(file: UnattributedFileView): string {
  const ranges: LineRange[] =
    file.addedRanges.length > 0 ? file.addedRanges : file.removedRanges;

  const fragments = ranges.map((range) =>
    range.start === range.end
      ? `${range.start}`
      : `${range.start}–${range.end}`,
  );

  if (fragments.length <= MAX_RANGE_FRAGMENTS) return fragments.join(", ");
  return `${fragments.slice(0, MAX_RANGE_FRAGMENTS).join(", ")}, …`;
}

/** The legal chunk shape DiffTable renders; carries the pre-sliced rows. */
export function toDisplayChunk(file: UnattributedFileView): BriefChunk {
  return {
    id: `unattributed:${file.file}`,
    changeGroupId: "",
    file: file.file,
    concern: "implementation",
    role: "supporting",
    loc: { added: file.added, deleted: file.deleted },
    addedRanges: file.addedRanges,
    removedRanges: file.removedRanges,
    riskSurface: [],
    ...(file.diff === undefined ? {} : { diff: file.diff }),
  };
}
