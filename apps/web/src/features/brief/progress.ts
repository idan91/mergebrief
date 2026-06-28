import type { Disposition } from "../review/session";
import type { Concern } from "./types";
import type { BriefViewModel } from "./viewModel";

export type CheckBucket = `carrier:${string}` | `support:${string}:${Concern}`;

export interface ProgressTotals {
  playbookChecked: number;
  playbookTotal: number;
  reviewed: number;
  chunkTotal: number;
  flagsResolved: number;
  flagTotal: number;
}

export function summarizeProgress(
  model: BriefViewModel,
  reviewedChunks: Set<string>,
  dispositions: Record<string, Disposition>,
): ProgressTotals {
  const flagsResolved = Object.values(dispositions).filter(
    (disposition) => disposition.kind !== "open",
  ).length;

  return {
    playbookChecked: 0,
    playbookTotal: 0,
    reviewed: reviewedChunks.size,
    chunkTotal: model.groups.reduce(
      (total, group) => total + group.chunks.length,
      0,
    ),
    flagsResolved,
    flagTotal: model.flags.length,
  };
}
