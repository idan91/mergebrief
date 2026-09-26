import type { CSSProperties } from "react";
import type { ThreadComposerWiring } from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import type {
  ChunkComparisonView,
  ComparisonRun,
  ComparisonSource,
} from "../../../comparison/runs";
import type {
  AddressedReviewComment,
  BriefChunk,
  RevisionNarrativeSkipReason,
} from "../../../types";
import type { RowTokenMap } from "@web/utils/diffTokens/types";
import type { ValueOf } from "types/utils";
import type {
  DiffView,
  LineSide,
  SplitSide,
} from "@web/components/DiffRows/types";
import type { ExpandedRows } from "../../../hooks/useExpandedRows";
import type { DiffRowView } from "./diffRowView";
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
  /** Where a sibling span's control lands; the control needs this and `deriveChunkUrl`. */
  jumpToLine?: ((chunkId: string, target: LineTarget) => void) | undefined;
  /** The URL that addresses a chunk, the sibling span control's link. */
  deriveChunkUrl?: ((chunkId: string) => string) | undefined;
}

export interface RailView {
  run: ComparisonRun | undefined;
  isStart: boolean;
  isEnd: boolean;
}

/** Which gutter a rail paints in: the table's left edge, or the split seam. */
export const RailSides = {
  EDGE: "edge",
  SEAM: "seam",
} as const;
export type RailSide = ValueOf<typeof RailSides>;

export interface SideRailInput {
  side: RailSide;
  /** The row view of the side this gutter sits beside. */
  own: DiffRowView | undefined;
  /** The paired side's view, for the run it shares. */
  other: DiffRowView | undefined;
  /** False in unified view, where the one gutter paints every run. */
  hasSeam: boolean;
  /** Whether a run holds a deleted row, so it speaks for the old side. */
  touchesOld: (run: ComparisonRun) => boolean;
}

export interface UnderRowLayout {
  columnCount: number;
  sideColumns: number | undefined;
}

export interface DragSelection {
  indexes: number[];
  /** The side a same-side drag stays on; absent spans both. */
  placement: SplitSide | undefined;
}

/** What a drag ends in: a composer from the sign, a selection from the numbers. */
export const DragModes = {
  COMMENT: "comment",
  SELECT: "select",
} as const;
export type DragMode = ValueOf<typeof DragModes>;

/** Where the selection's link glyph renders: a rendered row on one side. */
export interface SelectionGlyphPlacement {
  index: number;
  side: LineSide;
}
