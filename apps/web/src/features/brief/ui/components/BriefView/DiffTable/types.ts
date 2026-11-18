import type { CSSProperties } from "react";
import type { RevisionNarrativeSkipReason } from "brief-core/types";
import type { ThreadComposerWiring } from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import type {
  ChunkComparisonView,
  ComparisonRun,
  ComparisonSource,
} from "../../../../model/comparison/runs";
import type {
  AddressedReviewComment,
  BriefChunk,
} from "../../../../model/types";
import type { RowTokenMap } from "@web/utils/diffTokens/types";
import type { ValueOf, DiffSide } from "types";
import type { DiffView, SplitSide } from "@web/components/DiffRows/types";
import type { ExpandedRows } from "../../../../model/expansion/useExpandedRows";
import type { DiffRowView } from "./diff-row-view";
import type {
  FileLineOwners,
  LineTarget,
} from "../../../../model/utils/line-owner";
import type { GuestRowsInput } from "../../../utils/guest-rows";

// csstype's CSSProperties has no `--*` index; a typed extension keeps the
// custom property cast-free.
export interface DiffViewportStyle extends CSSProperties {
  "--diff-rows": number;
  /** The stored reservation in px; absent for a brief without stored counts. */
  "--diff-reserved-size"?: string;
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
  /**
   * Rows another diff produced. Every row is foreign: the resolver names
   * the full brief's chunk that owns its line, or why it takes no comment.
   * Sibling frames, expansion and the comparison overlay stay off.
   */
  guest?: GuestRowsInput | undefined;
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

/** The range-anchoring drag in flight: where it started, where the pointer is. */
export interface RangeDrag {
  mode: DragMode;
  start: number;
  /** The side each end sits on in split view; absent in unified. */
  startSide: SplitSide | undefined;
  current: number;
  currentSide: SplitSide | undefined;
}

/** What a gesture landed on: a row's own button owns the gesture itself. */
export const RowTargets = {
  BUTTON: "button",
  NUMBERS: "numbers",
  SIGN: "sign",
  CODE: "code",
} as const;
export type RowTarget = ValueOf<typeof RowTargets>;

export const RowGestureKinds = {
  KEY_DOWN: "key-down",
  MOUSE_DOWN: "mouse-down",
  MOUSE_ENTER: "mouse-enter",
  MOUSE_UP: "mouse-up",
} as const;
/** @public */
export type RowGestureKind = ValueOf<typeof RowGestureKinds>;

export interface RowKeyDown {
  kind: typeof RowGestureKinds.KEY_DOWN;
  key: string;
  shift: boolean;
  target: RowTarget;
}

export interface RowMouseDown {
  kind: typeof RowGestureKinds.MOUSE_DOWN;
  shift: boolean;
  target: RowTarget;
}

export interface RowMouseEnter {
  kind: typeof RowGestureKinds.MOUSE_ENTER;
}

export interface RowMouseUp {
  kind: typeof RowGestureKinds.MOUSE_UP;
  /** The primary button was released. */
  primary: boolean;
  shift: boolean;
  target: RowTarget;
  /** A non-collapsed text selection has an end inside this table. */
  textSelected: boolean;
}

export type RowGesture = RowKeyDown | RowMouseDown | RowMouseEnter | RowMouseUp;

/**
 * How a row answers a gesture: a line a selection or comment starts on, or
 * a guest row GitHub cannot hold a comment on, whose pick shows the reason.
 */
export const RowStateKinds = {
  LINE: "line",
  REASON: "reason",
} as const;
/** @public */
export type RowStateKind = ValueOf<typeof RowStateKinds>;

/** The drag in flight as one row sees it. */
export interface RowDragState {
  mode: DragMode;
  startedHere: boolean;
}

interface RowStateBase {
  drag: RowDragState | undefined;
  composerOpen: boolean;
  hasSelection: boolean;
}

export interface LineRowState extends RowStateBase {
  kind: typeof RowStateKinds.LINE;
  reanchorArmed: boolean;
  /** The live selection covers this row on this side. */
  lineSelected: boolean;
  commentable: boolean;
  split: boolean;
}

export interface ReasonRowState extends RowStateBase {
  kind: typeof RowStateKinds.REASON;
  reasonOpen: boolean;
}

export type RowState = LineRowState | ReasonRowState;

/** One step a row takes for a gesture, run in order. */
export const RowEffects = {
  DROP_TEXT_SELECTION: "drop-text-selection",
  BEGIN_SELECT_DRAG: "begin-select-drag",
  BEGIN_COMMENT_DRAG: "begin-comment-drag",
  MOVE_DRAG: "move-drag",
  CLEAR_DRAG: "clear-drag",
  MARK_SELECTING_SIDE: "mark-selecting-side",
  SELECT_RANGE: "select-range",
  EXTEND_SELECTION: "extend-selection",
  CLEAR_SELECTION: "clear-selection",
  COMMENT_RANGE: "comment-range",
  COMMENT_SELECTION: "comment-selection",
  TOGGLE_REASON: "toggle-reason",
  CLOSE_REASON: "close-reason",
} as const;
export type RowEffect = ValueOf<typeof RowEffects>;

export interface RowIntent {
  effects: RowEffect[];
  preventDefault: boolean;
  /** The row consumes the key, so the composer's and the screen's never see it. */
  stopPropagation: boolean;
}

/** Where the selection's link glyph renders: a rendered row on one side. */
export interface SelectionGlyphPlacement {
  index: number;
  side: DiffSide;
}
