import type { BriefChunk } from "../../../../types";
import type { BriefViewModel, GroupView } from "../../../../utils/viewModel";

export interface GroupCardProps {
  /** Set on the article so the story splitter can name it as its pane. */
  id?: string | undefined;
  group: GroupView;
  brief: { chunks: BriefChunk[] };
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
  /**
   * Changed-since marker inputs, primitives so the memo boundary survives
   * parent re-renders. Marker renders iff the shortsha is present
   * (a checkpoint exists); count 0 = "unchanged since your last review".
   */
  sinceChangedFileCount?: number | undefined;
  sinceBaselineShortSha?: string | undefined;
  /** Opens the delta lens; route-owned, stable (memo boundary rides on it). */
  openDeltaLens?: (() => void) | undefined;
}
