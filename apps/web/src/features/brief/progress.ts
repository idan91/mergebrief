import type { FlagState } from "../review/state";
import type { Category, Concern } from "./types";
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
  checkedItems: Record<CheckBucket, Set<number>>,
  reviewedChunks: Set<string>,
  flagStates: Record<string, FlagState>,
  dominants: Record<string, Category>,
): ProgressTotals {
  void checkedItems;
  void dominants;
  const flagsResolved = Object.values(flagStates).filter(
    (flag) => flag.status !== "open",
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
