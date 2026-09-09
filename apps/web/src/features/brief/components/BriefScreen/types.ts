import type { ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import type { SubmitReviewAction } from "@web/features/review/utils";
import type { ReviewSessionPayload } from "@web/features/review/session";
import type {
  MarkReadyAction,
  PostCommentResult,
} from "@web/features/pulls/transport";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { Brief, LivePrState, LocalBriefSummary } from "../../types";
import type { buildBriefViewModel } from "../../utils/viewModel";
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

export interface LensPaneProps {
  frozen: boolean;
  children: ReactNode;
}

export interface BriefScreenProps {
  /** DB route; absent on the file path. */
  livePrState?: LivePrState | undefined;
  artifacts: LocalBriefSummary[];
  brief: Brief;
  repoConfig?: RepoConfigContext | null | undefined;
  briefId: string;
  comparisonPlan?: BriefComparisonPlan | undefined;
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
  exitChangesScope?: (() => void) | undefined;
  /** Content goes inert; the sticky header stays live. */
  revisionPending?: boolean | undefined;
}
