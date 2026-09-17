import type { CSSProperties, ReactNode } from "react";
import type { ThreadComposerWiring } from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import type {
  ChunkComparisonView,
  ComparisonRun,
  ComparisonSource,
} from "../../../comparison/comparison";
import type {
  AddressedReviewComment,
  BriefChunk,
  RevisionNarrativeSkipReason,
} from "../../../types";
import type { RowTokenMap } from "@web/utils/diffTokens/types";
import type { DiffView, SplitSide } from "@web/components/DiffRows/types";
import type { ExpandedRows } from "../../../hooks/useExpandedRows";
import type { FileLineOwners, LineTarget } from "../../../utils/lineOwner";

// csstype's CSSProperties has no `--*` index; a typed extension keeps the
// custom property cast-free.
export interface DiffViewportStyle extends CSSProperties {
  "--diff-rows": number;
}

export interface DiffTableProps {
  chunk: BriefChunk;
  comparisonView: ChunkComparisonView;
  comparisonSource: ComparisonSource;
  comparisonSkipReason: RevisionNarrativeSkipReason | null;
  addressedComments: AddressedReviewComment[];
  /** Live conversation threads under their diff rows. */
  conversationThreadsByRow?: ReadonlyMap<number, DigestThreadRow[]> | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
  reviewCommentLabel: string;
  /**
   * Hard read-only override (the RawSpanDiff case): every write affordance
   * stands down with THIS reason regardless of the flow store's posture, and
   * no review comments render, a raw-span chunk id could collide with a
   * brief chunk id, so the store's chunk-keyed reads must not apply.
   */
  readOnlyReason?: string | undefined;
  /** Syntax tokens keyed by row index; absent renders every row plain. */
  tokensByRow?: RowTokenMap | undefined;
  tokensPending?: boolean;
  /** Paired sides per hunk; the caller resolves the width floor. */
  view?: DiffView;
  /** The chunk's rows with expanded context spliced in; absent renders `chunk.diff`. */
  expansion?: ExpandedRows | undefined;
  /** Shipped threads on lines no chunk renders; the expand control counts them. */
  hiddenThreads?: readonly DigestThreadRow[] | undefined;
  /** Every current line thread of the file; an expanded row shows the one on its line. */
  fileThreads?: readonly DigestThreadRow[] | undefined;
  /** The file's chunks and their labels; absent leaves expanded changed rows unframed. */
  lineOwners?: FileLineOwners | undefined;
  /** Where a sibling span's control lands; absent renders the header without one. */
  jumpToLine?: ((chunkId: string, target: LineTarget) => void) | undefined;
}

export interface RailView {
  run: ComparisonRun | undefined;
  isStart: boolean;
  isEnd: boolean;
}

export interface UnderRowLayout {
  columnCount: number;
  sideColumns: number | undefined;
}

export interface UnderRowProps {
  layout: UnderRowLayout;
  /** Under one side in the split view; absent spans the whole row. */
  placement?: SplitSide | undefined;
  conversationThread?: number | undefined;
  children: ReactNode;
}

export interface DragSelection {
  indexes: number[];
  /** The side a same-side drag stays on; absent spans both. */
  placement: SplitSide | undefined;
}
