import type { LineRange } from "brief-core/types";
import type { TFunction } from "i18next";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { ValueOf } from "types/utils";

/** The PR state as the header's badge and the stack rows draw it: draft and merged are their own words. */
export const PrStateBadgeVariants = {
  OPEN: "open",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PrStateBadgeVariant = ValueOf<typeof PrStateBadgeVariants>;

import type {
  ConversationPlan,
  ThreadComposerWiring,
} from "@web/features/conversation";
import type {
  ConversationFilter,
  DigestRow,
  DigestThreadRow,
  ReviewerFacet,
  VerdictFacet,
} from "@web/features/conversation/utils";
import type { UseReviewSubmitValue } from "@web/features/review/hooks";
import type {
  ReviewFlowStore,
  ReviewSessionPayload,
  SessionReadSource,
  SessionWrites,
} from "@web/features/review/session";
import type {
  LineLinkTarget,
  LineSelection,
  SubmitReviewAction,
  UnresolvedItem,
} from "@web/features/review/utils";
import type { DiffView } from "@web/components/DiffRows/types";
import type { ViewportBand } from "@web/hooks/useViewportBoundary";
import type {
  BriefSearchParams,
  ViewParam,
} from "../../../model/comparison/compare-state";
import type { BriefComparisonPlan } from "../../../model/comparison/types";
import type {
  Brief,
  BriefChunk,
  LivePrState,
  MarkReadyAction,
  PostCommentResult,
  RevisionTimelinePlan,
} from "../../../model/types";
import type { ExpansionDirection } from "brief-core/chunk-layout";
import type { ExpansionStore } from "../../../model/expansion/useExpansion";
import type { ExpansionSource } from "../../../model/expansion/useExpansionSource";
import type { LineTarget } from "../../../model/utils/line-owner";
import type {
  AttributeRail,
  BriefViewModel,
} from "../../../model/utils/view-model";
import type { FileRowsCache } from "../../../model/file-rows/cache";
import type { ChunkLayoutState } from "../../../model/chunk-layout/useChunkLayout";
import type { RepoConfigContext } from "../../../model/utils/repo-config";
import type { ReviewPosture } from "../../hooks/useReviewPosture";
import type { RevisionNavigation } from "../../hooks/useRevisionNavigation";
import type {
  DiffFetchRetry,
  DiffRetryLanding,
} from "../DiffTimeoutNotice/types";
import type { BriefAddressPort } from "./address/types";
import type { UseComparisonOverlayValue } from "./comparison/useComparisonOverlay";
import type { IntentBarHandle } from "./IntentBar";
import type { UseMarkReadyFlowValue } from "./mark-ready/useMarkReadyFlow";
import type { ChunkWindowRegistry } from "./reading/chunk-windows";
import type { ReadingPositionStore } from "./reading/reading-position";
import type { VisibleRegions } from "./reading/regions";
import type { UseReadingSessionValue } from "./reading/useReadingSession";
import type { JumpToChunkFromConversation } from "./scroll-to-target/types";
import type { SidebarState } from "./Sidebar/useSidebarState";
import type { BriefViewStore } from "./store";
import type { SidebarLayout } from "./utils";

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
  /** GitHub did not render the span in time; the pane offers one retry. */
  TIMED_OUT: "timed-out",
} as const;
export type DeltaSpanStatus = ValueOf<typeof DeltaSpanStatuses>;

/** The delta span's timeout retry, its landing line, and the section focus lands on. */
export interface DeltaSpanLanding extends DiffRetryLanding {
  readonly sectionRef: RefObject<HTMLDivElement | null>;
}

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

export interface ScopePaneProps {
  frozen: boolean;
  children: ReactNode;
}

/** What a line link resolves to before anything scrolls. */
export const LineLinkPlanKinds = {
  /** No such chunk, or a line the brief cannot show. */
  MISS: "miss",
  /** The chunk's rows are not attached yet; the link keeps its chance. */
  PENDING: "pending",
  /** The rows never came: the chunk's card is shown without the line. */
  CARD: "card",
  ROW: "row",
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
export interface LineLinkRead {
  edgeKey: string;
  direction: ExpansionDirection;
  /** In new-side lines, from the edge to the far folded line. */
  range: LineRange;
  /** The range's first line is among the folded ones. */
  coversStart: boolean;
}

export type LineLinkPlan =
  | { kind: typeof LineLinkPlanKinds.MISS }
  | { kind: typeof LineLinkPlanKinds.PENDING }
  | { kind: typeof LineLinkPlanKinds.CARD; chunk: BriefChunk }
  | {
      kind: typeof LineLinkPlanKinds.ROW;
      chunk: BriefChunk;
      row: LineTarget;
      read?: LineLinkRead;
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
  /** Stored card sizes and whether the code is still pending; absent reads from the estimate. */
  chunkLayout?: ChunkLayoutState | undefined;
  comparisonPlan?: BriefComparisonPlan | undefined;
  /** Absent or null renders as if no repo config exists. */
  repoConfig?: RepoConfigContext | null | undefined;
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
  /** The PR author's GitHub login; absent when GitHub sent no user. */
  authorLogin?: string | undefined;
  /** Identity for in-app neighbour links and the hunk-edge file reads. */
  repoId: string;
  openComparison: () => void;
  headerControls: ReactNode;
  /** Present while the brief's own diff read timed out with no rows landed. */
  diffTimeout?: DiffFetchRetry | undefined;
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
  /** The viewer wrote the PR, so GitHub refuses their Approve or Request changes. */
  viewerIsAuthor?: boolean;
}

/** Present only where the Brief has a pull request conversation to show. */
export interface ConversationCapability {
  plan: ConversationPlan;
  focusThreadId?: number | undefined;
  filter?: ConversationFilter | undefined;
  onFilterChange: (next: ConversationFilter) => void;
}

/** Grouped by supplier: the file route supplies `reading` and `address` only. */
export interface BriefViewProps {
  reading: BriefReading;
  address: BriefAddress;
  pr?: PullRequestContext | undefined;
  review?: ReviewCapability | undefined;
  conversation?: ConversationCapability | undefined;
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
  /** GitHub or the repository refused the viewer's own permission to comment. */
  NO_PERMISSION: "no-permission",
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

export type UseComparisonInput = Pick<BriefViewProps, "reading" | "address">;

export interface SinceMarkers {
  counts: Map<string, number>;
  baselineShortSha: string;
}

export interface ComparisonState {
  attributeRail: AttributeRail;
  pendingShown: boolean;
  overlay: UseComparisonOverlayValue;
  sinceMarkers: SinceMarkers | undefined;
}

export interface UseReadingInput {
  props: Pick<BriefViewProps, "reading" | "address" | "pr">;
  overlay: Pick<UseComparisonOverlayValue, "compareState" | "comparison">;
  ownDraftActive: boolean;
}

export interface ReadingState {
  chunkWindowsRef: RefObject<ChunkWindowRegistry>;
  /** The sidebar's scroll to top, holding every window's compensation. */
  scrollToTop: () => void;
  readingPosition: ReadingPositionStore;
  expansion: ExpansionStore;
  viewStore: BriefViewStore;
  session: UseReadingSessionValue;
  jumpToChunkUnderStack: (chunkId: string, behavior?: ScrollBehavior) => void;
  expansionSource: ExpansionSource | undefined;
  revisionNav: RevisionNavigation;
}

export interface UseViewLayoutInput {
  viewStore: BriefViewStore;
  readingPosition: ReadingPositionStore;
  session: Pick<
    UseReadingSessionValue,
    "focusMode" | "jumpToGroup" | "jumpToGroupHeading"
  >;
  scope: ViewParam;
}

export interface ViewLayout {
  regions: VisibleRegions;
  band: ViewportBand;
  focusPanel: FocusPanelControl;
  focusPanelShown: boolean;
  sidebar: SidebarState;
  sidebarLayout: SidebarLayout;
  inChangesScope: boolean;
  changesPaneMounted: boolean;
  storyPaneMounted: boolean;
  queueJumpFromChanges: (groupId: string, heading: boolean) => void;
}

export interface UseReviewFlowStateInput {
  t: TFunction;
  props: Pick<BriefViewProps, "reading" | "review">;
  viewStore: BriefViewStore;
  session: Pick<UseReadingSessionValue, "actions" | "reviewComments">;
  inChangesScope: boolean;
}

export interface ConversationReadOnly {
  readOnlyReason?: string;
}

export interface BriefReviewFlowState {
  writesDisabledReason: string | undefined;
  writesDisabled: boolean;
  conversationReadOnly: ConversationReadOnly;
  draftCommentCount: number;
  reanchorArmed: boolean;
  reanchorLocation: string | undefined;
  cancelReanchorFromBanner: () => void;
  submitOpen: boolean;
  openSubmit: () => void;
  closeSubmit: () => void;
  flowStore: ReviewFlowStore;
  announce: (message: string) => void;
  toast: string;
  liveMessage: string;
  lineSelection: LineSelection | null;
  riskModalOpen: boolean;
}

export interface FlowNoticesInput {
  t: TFunction;
  flowStore: ReviewFlowStore;
  toast: string;
  clearWriteError: () => void;
}

/** What the toolbar's Filter disclosure needs to draw itself. */
export interface ConversationFilterFacets {
  readonly verdicts: readonly VerdictFacet[];
  readonly reviewers: readonly ReviewerFacet[];
  readonly hiddenInlineThreads: number;
  /**
   * Applied filter with unmatched reviewers removed. Receipts, pressed states and
   * chip updates share it so ghost logins cannot claim a filter or persist in the URL.
   */
  readonly applied: ConversationFilter;
}

export interface UseConversationRowsValue {
  conversationByChunk: ReadonlyMap<string, DigestRow[]> | undefined;
  /** Live threads on lines no chunk renders, per file. */
  hiddenThreadsByFile: ReadonlyMap<string, DigestThreadRow[]> | undefined;
  /** Every current line thread of a file; an expanded row shows the one on its line. */
  lineThreadsByFile: ReadonlyMap<string, DigestThreadRow[]> | undefined;
  /** Facets for the Filter disclosure; absent until the conversation resolves. */
  conversationFilterFacets: ConversationFilterFacets | undefined;
}

export interface ConversationWiring extends UseConversationRowsValue {
  conversationComposer: ThreadComposerWiring | undefined;
  conversationGroupIds: Set<string> | undefined;
  invalidateConversation: (() => void) | undefined;
  jumpToChunkFromConversation: JumpToChunkFromConversation;
  jumpToConversation: () => void;
  open: boolean;
  toggleOpen: () => void;
}

export interface UseAddressSyncInput {
  t: TFunction;
  props: Pick<BriefViewProps, "reading" | "address" | "conversation">;
  readingState: Pick<
    ReadingState,
    "session" | "readingPosition" | "expansion" | "expansionSource"
  >;
  scope: ViewParam;
  flow: Pick<BriefReviewFlowState, "flowStore" | "announce">;
  lineSelection: LineSelection | null;
  conversationWiring: Pick<ConversationWiring, "jumpToChunkFromConversation">;
}

export interface AddressSync {
  lineLinkMissed: boolean;
  dismissLineLinkMiss: () => void;
  shareChunk: ChunkShare;
  queueChunkJumpFromChanges: (chunkId: string) => void;
}

export interface UseReviewCommandsInput {
  t: TFunction;
  props: Pick<BriefViewProps, "reading" | "review">;
  ownDraftActive: boolean;
  staleHead: boolean;
  viewStore: BriefViewStore;
  session: UseReadingSessionValue;
  flow: Pick<
    BriefReviewFlowState,
    | "flowStore"
    | "announce"
    | "closeSubmit"
    | "submitOpen"
    | "writesDisabled"
    | "writesDisabledReason"
  >;
  riskModalOpen: boolean;
  conversationWiring: Pick<ConversationWiring, "invalidateConversation">;
}

export interface ReviewCommands {
  submitFlow: UseReviewSubmitValue;
  liveSubmit: boolean;
  markReady: UseMarkReadyFlowValue;
  intentBarRef: RefObject<IntentBarHandle | null>;
  posture: ReviewPosture;
  submitFromModal: () => void;
  jumpToSubmitItem: (item: Pick<UnresolvedItem, "targetId">) => void;
  markViewedFromShortcut: (chunkId: string) => void;
}

export interface UseViewShortcutsInput {
  t: TFunction;
  props: Pick<BriefViewProps, "conversation">;
  pendingShown: boolean;
  scope: ViewParam;
  readingPosition: ReadingPositionStore;
  session: UseReadingSessionValue;
  layout: Pick<
    ViewLayout,
    "regions" | "band" | "sidebar" | "focusPanel" | "focusPanelShown"
  >;
  flow: Pick<BriefReviewFlowState, "flowStore" | "submitOpen">;
  lineSelection: LineSelection | null;
  reanchorArmed: boolean;
  riskModalOpen: boolean;
  markReady: Pick<UseMarkReadyFlowValue, "gateOpen">;
  markViewedFromShortcut: (chunkId: string) => void;
  conversationWiring: Pick<ConversationWiring, "jumpToConversation">;
  toggleDiffView: (() => void) | undefined;
}

export interface AnnouncedRevisionNavInput {
  t: TFunction;
  revisionNav: RevisionNavigation;
  announceQuietly: (message: string) => void;
}

export interface DiffViewToggleInput {
  t: TFunction;
  view: DiffView;
  setView: (view: DiffView) => void;
  announce: (message: string) => void;
  inChangesScope: boolean;
}
