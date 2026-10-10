import type { LineRange } from "brief-core/types";
import type { CSSProperties, ReactNode } from "react";
import type { ValueOf } from "types/utils";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import type {
  ReviewSessionPayload,
  SessionReadSource,
  SessionWrites,
} from "@web/features/review/session";
import type {
  LineLinkTarget,
  SubmitReviewAction,
} from "@web/features/review/utils";
import type { BriefSearchParams } from "../../../model/comparison/compareState";
import type {
  Brief,
  BriefChunk,
  LivePrState,
  LocalBriefSummary,
  MarkReadyAction,
  PostCommentResult,
  RevisionTimelinePlan,
} from "../../../model/types";
import type { ExpansionDirection } from "../../../model/expansion/types";
import type { LineTarget } from "../../../model/utils/lineOwner";
import type { BriefViewModel } from "../../../model/utils/viewModel";
import type { FileRowsCache } from "../../../model/file-rows/cache";
import type { RepoConfigContext } from "../../../model/utils/repoConfig";
import type { BriefAddressPort } from "./address/types";
import type { BriefComparisonPlan } from "./useComparisonOverlay";

/**
 * Where the last-review delta's rows stand: the database path fetches the
 * span diff after the delta lands, so a card shows its summary first and
 * its rows when the diff arrives. `absent` covers the local path, where the
 * delta's own sidecar carries the rows, and a plan with no span diff.
 */
export const DeltaSpanStatuses = {
  ABSENT: "absent",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error",
} as const;
export type DeltaSpanStatus = ValueOf<typeof DeltaSpanStatuses>;

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

export interface ProgressFillStyle extends CSSProperties {
  /** The filled fraction of a read-through segment's track, 0 to 1. */
  "--fill": string;
}

export interface LensPaneProps {
  frozen: boolean;
  children: ReactNode;
}

/** What a line link resolves to before anything scrolls. */
export const LineLandingKinds = {
  /** No such chunk, or a line the brief cannot show. */
  MISS: "miss",
  /** The chunk's rows are not attached yet; the link keeps its chance. */
  PENDING: "pending",
  /** The rows never came: the chunk's card is shown without the line. */
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
  /** Writes the chunk link and stands a line selection down. */
  commit: (chunkId: string) => void;
}

/** How a scope exit writes the URL: a gesture pushes, an arrival replaces. */
export interface ScopeExitOptions {
  replace: boolean;
}

/** What a route has loaded for the reader to read. */
export interface BriefReadingSource {
  brief: Brief;
  briefId: string;
  /** The diff's rows per file; absent leaves every hunk edge folded. */
  fileRows?: FileRowsCache | undefined;
  comparisonPlan?: BriefComparisonPlan | undefined;
  /** Absent or null renders as if no repo config exists. */
  repoConfig?: RepoConfigContext | null | undefined;
  /** The local Briefs a file Brief compares against; the DB route compares through `comparisonPlan`. */
  artifacts?: LocalBriefSummary[] | undefined;
  /** The Brief's revisions for the Sidebar tab; absent hides it. */
  revisions?: RevisionTimelinePlan | undefined;
}

export interface BriefReading extends BriefReadingSource {
  model: BriefViewModel;
}

/** Where the reader is and how the screen moves them; the route's router supplies all of it. */
export interface BriefAddress extends Omit<BriefAddressPort, "navigateSearch"> {
  searchParams: BriefSearchParams;
  /** IntentBar and Header Jump leave Changes Scope through this. */
  exitChangesScope: (options?: ScopeExitOptions) => void;
  /** A navigation to another Brief is in flight: content goes inert, the header stays live. */
  revisionPending: boolean;
}

/** Present only where the Brief belongs to a live pull request. */
export interface PullRequestContext {
  livePrState: LivePrState;
  /** Identity for in-app neighbour links and the hunk-edge file reads. */
  repoId: string;
  openDeltaLens: () => void;
  headerControls: ReactNode;
}

/** Present only where the reader has a review session to write to; absent reads only. */
export interface ReviewCapability {
  /** Absent leaves Submit a local mockup. */
  submitReview?: SubmitReviewAction | undefined;
  /** Base drift: anchors can land wrong, so nothing is written. */
  readOnly?: { reason: string } | undefined;
  /** Head drift: the composer stays live, Submit gates behind an ack. */
  staleHead: boolean;
  ownDraft?: OwnDraftPlan | undefined;
  session?: ReviewSessionPayload | undefined;
  /** Every session read after the first. */
  sessionReads?: SessionReadSource | undefined;
  writes?: SessionWrites | undefined;
}

/** Present only where the Brief has a pull request conversation to show. */
export interface ConversationCapability {
  plan: ConversationPlan;
  focusThreadId?: number | undefined;
  filter?: ConversationFilter | undefined;
  onFilterChange: (next: ConversationFilter) => void;
}

/** Grouped by supplier: the file route supplies `reading` and `address` only. */
export interface BriefScreenProps {
  reading: BriefReading;
  address: BriefAddress;
  pr?: PullRequestContext;
  review?: ReviewCapability;
  conversation?: ConversationCapability;
}

/** What the link param names: a chunk, or lines inside one. */
export const LinkTargetKinds = {
  CHUNK: "chunk",
  LINES: "lines",
} as const;

export type LinkTarget =
  | { kind: typeof LinkTargetKinds.CHUNK; chunkId: string }
  | { kind: typeof LinkTargetKinds.LINES; lines: LineLinkTarget };

export const LinkParamErrors = {
  MALFORMED: "malformed",
} as const;

export type LinkParamError = ValueOf<typeof LinkParamErrors>;

export interface FocusPanelControl {
  open: boolean;
  /** Below the tablet breakpoint the panel is a modal bottom sheet. */
  sheet: boolean;
  /** Pointer open and close, from the panel's own controls. */
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
}

export interface FilePathDirectory {
  /** The path up to and including this directory; unique within one path. */
  key: string;
  text: string;
}

export interface FilePathParts {
  directories: FilePathDirectory[];
  basename: string;
}

/**
 * How a single post ended. Every value except `posted`/`indeterminate` is a
 * DETERMINISTIC stop-cause (the comment definitively did NOT post), carried
 * granularly because a batch suppresses per-comment copy and its summary must
 * give the cause's own recovery. `indeterminate` = failure AROUND the write:
 * may or may not have reached GitHub.
 */
export const PostDraftOutcomes = {
  POSTED: "posted",
  REJECTED: "rejected",
  UNAUTHORIZED: "unauthorized",
  STALE: "stale",
  NOT_FOUND: "not-found",
  INDETERMINATE: "indeterminate",
} as const;
export type PostDraftOutcome = ValueOf<typeof PostDraftOutcomes>;

export interface MarkReadyBatch {
  current: number;
  total: number;
}
