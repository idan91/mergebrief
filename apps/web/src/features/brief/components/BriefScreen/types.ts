import type { CSSProperties, ReactNode } from "react";
import type { ValueOf } from "types/utils";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import type { SubmitReviewAction } from "@web/features/review/utils";
import type { ReviewSessionPayload } from "@web/features/review/session";
import type {
  MarkReadyAction,
  PostCommentResult,
} from "@web/features/pulls/transport";
import type { BriefSearchParams } from "../../comparison/compareState";
import type {
  Brief,
  BriefChunk,
  ExpansionDirection,
  LineRange,
  LivePrState,
  LocalBriefSummary,
} from "../../types";
import type { LineTarget } from "../../utils/lineOwner";
import type { buildBriefViewModel } from "../../utils/viewModel";
import type { FileRowsCache } from "../../utils/fileRows";
import type { RepoConfigContext } from "../../utils/repoConfig";
import type { BriefComparisonPlan } from "./useComparisonOverlay";

/**
 * Present only while `draft && viewerIsAuthor`. Hides submit/receipt, mirrors
 * flags read-only, and puts Mark ready in the terminal-action slot.
 */
export interface OwnDraftPlan {
  /** Absent on a historical revision, the soft gate lists current-head flags. */
  readonly markReady?: MarkReadyAction;
  /** Same absence as `markReady`; hides the Post affordance. */
  readonly postComment?: (draftId: string) => Promise<PostCommentResult>;
}

// csstype's CSSProperties has no `--*` index; a typed extension keeps the
// custom property cast-free.
export interface StoryMainStyle extends CSSProperties {
  "--story-card-track"?: string;
}

export interface LensPaneProps {
  frozen: boolean;
  children: ReactNode;
}

/** What a line link resolves to before anything scrolls. */
export const LineLandingKinds = {
  /** No file, no chunk, or a line the brief cannot show. */
  MISS: "miss",
  /** The owner's rows are not attached yet; the hash keeps its chance. */
  PENDING: "pending",
  /** The rows never came: the owner's card is shown without the line. */
  CARD: "card",
  LAND: "land",
} as const;

/** How a hunk-edge read for a line link ended. */
export const LineReadOutcomes = {
  LANDED: "landed",
  /** The file ends before the line, or the range is past the read cap. */
  SHORT: "short",
  /** The source could not answer now; the link may still be right. */
  UNAVAILABLE: "unavailable",
} as const;

export type LineReadOutcome = ValueOf<typeof LineReadOutcomes>;

/** The hunk-edge read that brings a folded line into the rows. */
export interface LineLandingRead {
  edgeKey: string;
  direction: ExpansionDirection;
  /** In new-side lines, from the edge to the far folded line. */
  range: LineRange;
  /** The range's first line is among the folded ones. */
  coversStart: boolean;
}

export type LineLandingPlan =
  | { kind: typeof LineLandingKinds.MISS }
  | { kind: typeof LineLandingKinds.PENDING }
  | { kind: typeof LineLandingKinds.CARD; chunk: BriefChunk }
  | {
      kind: typeof LineLandingKinds.LAND;
      chunk: BriefChunk;
      row: LineTarget;
      read?: LineLandingRead;
    };

/** The chunk link glyph: the URL to copy, and what the page does once it is copied. */
export interface ChunkShare {
  deriveUrl: (chunkId: string) => string;
  /** Writes the chunk hash and stands a line selection down. */
  commit: (chunkId: string) => void;
}

/** How a scope exit writes the URL: a gesture pushes, an arrival replaces. */
export interface ScopeExitOptions {
  replace: boolean;
}

export interface BriefScreenProps {
  /** DB route; absent on the file path. */
  livePrState?: LivePrState | undefined;
  artifacts: LocalBriefSummary[];
  brief: Brief;
  repoConfig?: RepoConfigContext | null | undefined;
  briefId: string;
  /** DB route identity for in-app neighbour links; absent on the file path. */
  repoId?: string | undefined;
  comparisonPlan?: BriefComparisonPlan | undefined;
  /** The PR diff's rows per file; absent leaves every hunk edge folded. */
  fileRows?: FileRowsCache | undefined;
  model: ReturnType<typeof buildBriefViewModel>;
  searchParams: BriefSearchParams;
  submitReview?: SubmitReviewAction | undefined;
  conversation?: ConversationPlan | undefined;
  readOnly?: { reason: string } | undefined;
  /** Absent on the file path. */
  reviewSession?: ReviewSessionPayload | undefined;
  conversationFocusThreadId?: number | undefined;
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange?: ((next: ConversationFilter) => void) | undefined;
  headerControls?: ReactNode | undefined;
  ownDraft?: OwnDraftPlan | undefined;
  /** Composer stays live; Submit gates behind an ack. */
  staleHead?: boolean | undefined;
  openDeltaLens?: (() => void) | undefined;
  /**
   * Screen never touches the router. IntentBar and Header Jump leave Changes
   * through this; absent where no navigation is wired.
   */
  exitChangesScope?: ((options?: ScopeExitOptions) => void) | undefined;
  /** Drops the `diff` deep link once the viewer picks a view; route-owned. */
  clearDiffParam?: (() => void) | undefined;
  /**
   * Writes the URL hash with replace, an empty string clearing it; the
   * line selection rides through here. Route-owned, absent where no
   * navigation is wired.
   */
  navigateHash?: ((hash: string) => void) | undefined;
  /** Content goes inert; the sticky header stays live. */
  revisionPending?: boolean | undefined;
}

export const LineHashErrors = {
  /** Not this shape at all: a chunk hash, an in-page anchor, or nothing. */
  NOT_LINE_HASH: "not-line-hash",
  MALFORMED: "malformed",
} as const;

export type LineHashError = ValueOf<typeof LineHashErrors>;
