import type { buildConversationQueryOptions } from "../../queries";
import type { ReplyResult } from "../../types";
import type {
  ConversationResolutionPlan,
  ThreadRevisionJump,
} from "../../wiring";

/** The route-injected data plan (absent on the local demo path). */
export interface ConversationPlan {
  readonly queryOptions: ReturnType<typeof buildConversationQueryOptions>;
  /**
   * The repository GitHub is asked for mention suggestions. Absent on the
   * local demo path, where only the conversation's participants are offered.
   */
  readonly mentionRepoId?: string;
  readonly postReply: (
    rootCommentId: number,
    body: string,
  ) => Promise<ReplyResult>;
  readonly resolution?: ConversationResolutionPlan;
  readonly revisionJump?: ThreadRevisionJump;
  /**
   * The VIEWED revision's generation start: newer comments postdate the brief
   * and get marked, so an older revision honestly marks more. Absent marks
   * nothing.
   */
  readonly briefGeneratedAt?: string;
}
