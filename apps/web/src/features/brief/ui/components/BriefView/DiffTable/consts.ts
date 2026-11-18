import type { SiblingSpan } from "../../../../model/utils/sibling-spans";
import type { GuestRowResolution } from "../../../utils/guest-rows";
import type { TranslationKey } from "i18n";
import { type GuestRowReason, GuestRowReasons } from "../../../../model/types";
import { type ExpandableEdge } from "../../../../model/expansion/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { SplitRow } from "@web/components/DiffRows/types";
import type { DragSelection } from "./types";
import type { DigestThreadRow } from "@web/features/conversation/utils";

export const NO_PAIRS: SplitRow[] = [];

// A zero-width space keeps the empty side of an under-row a real cell.
export const EMPTY_GAP = "\u200B";

export const NO_DIFF: DiffLine[] = [];

/** Marks the sign a comment range may start from, read by the row handlers. */
export const COMMENT_ANCHOR_ATTRIBUTES = { "data-comment-anchor": "" };
export const COMMENT_ANCHOR_SELECTOR = "[data-comment-anchor]";
/** Marks the number cells a line selection starts from. */
export const SELECT_ANCHOR_ATTRIBUTES = { "data-select-anchor": "" };
export const SELECT_ANCHOR_SELECTOR = "[data-select-anchor]";

export const EMPTY_EXPANDED_THREADS: ReadonlySet<number> = new Set();

export const NO_SELECTION: DragSelection = {
  indexes: [],
  placement: undefined,
};

export const NO_EDGES: ExpandableEdge[] = [];

export const NO_HIDDEN_THREADS: DigestThreadRow[] = [];

export const NO_SPANS: SiblingSpan[] = [];

export const NO_GUEST_ROWS: (GuestRowResolution | undefined)[] = [];

export const GUEST_REASON_KEYS: Record<GuestRowReason, TranslationKey> = {
  [GuestRowReasons.REMOVED_BEFORE_HEAD]: "brief.diff.guest.removedBeforeHead",
  [GuestRowReasons.NOT_IN_PR_DIFF]: "brief.diff.guest.notInPrDiff",
  [GuestRowReasons.PR_DIFF_UNAVAILABLE]: "brief.diff.guest.prDiffUnavailable",
  [GuestRowReasons.FILE_NOT_IN_BRIEF]: "brief.diff.guest.fileNotInBrief",
};

/** Marks a table's first rendered frame: a windowed list paints it in full then. */
export const FIRST_PAINT_ATTRIBUTE = "data-first-paint";
