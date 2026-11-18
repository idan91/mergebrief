import type { ConversationPlan } from "@web/features/conversation";
import type { PrConversation } from "@web/features/conversation/types";
import type { ConversationFilter } from "@web/features/conversation/utils";
import type { ReviewSessionActions } from "@web/features/review/session";
import type { BriefChunk } from "../../../../model/types";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import type { ScrollToTarget } from "../scroll-to-target/types";
import type { ConversationCapability, ConversationWiring } from "../types";

/** The reading session's members the conversation wiring reads. */
interface ConversationSession {
  actions: Pick<ReviewSessionActions, "recordSubmittedReview">;
  /** The page's one scroll to target; it opens the card, since rows exist only on open cards. */
  scrollToTarget: ScrollToTarget["scrollToTarget"];
  /** A conversation scroll names its chunk the reading position. */
  setActiveChunk: (chunkId: string) => void;
  readingOrderedChunks: BriefChunk[];
  submittedReviewIds: number[];
}

export interface UseConversationInput {
  /** Absent on the local path; every output then self-disables. */
  conversation: ConversationCapability | undefined;
  model: BriefViewModel;
  session: ConversationSession;
}

export interface UseConversationRowsInput {
  /** The resolved conversation; absent until it loads and on the local path. */
  conversationData: PrConversation | undefined;
  conversationFilter: ConversationFilter | undefined;
  readingOrderedChunks: BriefChunk[];
  submittedReviewIds: number[];
  /** A primitive, not the plan: only this field of it affects the rows. */
  briefGeneratedAt: string | undefined;
}

export type UseConversationScrollInput = Pick<
  ConversationSession,
  "scrollToTarget" | "setActiveChunk"
>;

export interface ConversationState {
  conversationPlan: ConversationPlan | undefined;
  conversationWiring: ConversationWiring;
}
