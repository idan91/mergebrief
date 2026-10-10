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
import type { PrConversation } from "@web/features/conversation/types";
import type { LineTarget } from "../../../utils/lineOwner";
import type { BriefViewModel } from "../../../utils/viewModel";
import type { BriefChunk } from "../../../types";
import type { Landing, LandHistory } from "../landing/types";

export interface UseConversationWiringInput {
  /** The route's conversation plan; absent on the local path, every output
   * then self-disables. */
  conversation: ConversationPlan | undefined;
  /** The `?thread=` landing target: opens the section on mount AND on in-app
   * navigation that changes the target after mount. */
  conversationFocusThreadId: number | undefined;
  /** Reviewer/verdict filter, separate from the plan so a chip click cannot
   * churn the plan identity the ChunkCard memos ride on. */
  conversationFilter: ConversationFilter | undefined;
  /** The page's one landing; it opens the card, since rows exist only on open cards. */
  land: Landing["land"];
  /** A conversation landing names its chunk the reading position. */
  setActiveChunk: (chunkId: string) => void;
  model: BriefViewModel;
  readingOrderedChunks: BriefChunk[];
  submittedReviewIds: number[];
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

/** A thread's own row, addressable wherever the thread renders. */
export interface ThreadLanding {
  rowId: string;
  threadId: number;
}

export type ConversationLanding = ThreadLanding | LineTarget;

/** False when the landing could not be scheduled; see `Landing`. */
export type JumpToChunkFromConversation = (
  chunkId: string,
  target?: ConversationLanding,
  behavior?: ScrollBehavior,
  history?: LandHistory,
) => boolean;

export interface UseConversationRowsInput {
  /** The resolved conversation; absent until it loads and on the local path. */
  conversationData: PrConversation | undefined;
  conversationFilter: ConversationFilter | undefined;
  readingOrderedChunks: BriefChunk[];
  submittedReviewIds: number[];
  /** A primitive, not the plan: only this field of it affects the rows. */
  briefGeneratedAt: string | undefined;
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

export type UseConversationLandingInput = Pick<
  UseConversationWiringInput,
  "land" | "setActiveChunk"
>;

export interface UseConversationWiringValue extends UseConversationRowsValue {
  conversationComposer: ThreadComposerWiring | undefined;
  /** Which groups carry conversation threads, the TocBar's markers. */
  conversationGroupIds: Set<string> | undefined;
  /** Refetches the conversation after a posted inline comment; absent on the
   * local path. */
  invalidateConversation: (() => void) | undefined;
  jumpToChunkFromConversation: JumpToChunkFromConversation;
  jumpToConversation: () => void;
  open: boolean;
  toggleOpen: () => void;
}
