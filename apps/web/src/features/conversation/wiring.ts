import type { MentionUserCandidate } from "@web/components/MarkdownTextarea/types";
import type { ReplyResult, ResolveThreadResult } from "./types";

/** Jump to the briefed revision an outdated thread was anchored on. */
export interface ThreadRevisionJump {
  /** Briefed revision head SHAs a thread anchor can navigate to. */
  readonly knownHeads: ReadonlySet<string>;
  readonly onJump: (anchorSha: string, threadId: number) => void;
}

/** Absent from a plan means no resolve affordance renders at all. */
export interface ConversationResolutionPlan {
  /**
   * Display-only; GitHub enforces at mutation time. From the PR-meta payload
   * only: the list payload's `viewerCanResolve` is authorship-only, so a
   * false there is not a capability denial.
   */
  readonly canResolve: boolean;
  readonly setResolved: (
    rootCommentId: number,
    resolved: boolean,
  ) => Promise<ResolveThreadResult>;
  /** After a 403 the cached capability is suspect; re-read it. */
  readonly refetchCapability: () => void;
}

export interface ThreadResolutionWiring extends ConversationResolutionPlan {
  /** The row changes variant from refetched truth, never an optimistic edit. */
  readonly refetchConversation: () => void;
}

export interface ThreadComposerWiring {
  /** Why replying is off; absent = writable. */
  readonly readOnlyReason?: string | undefined;
  readonly post: (rootCommentId: number, body: string) => Promise<ReplyResult>;
  readonly onPosted: () => void;
  /** Merged after the thread's own participants, which rank first. */
  readonly mentionPool?: readonly MentionUserCandidate[];
  readonly revisionJump?: ThreadRevisionJump;
  readonly resolution?: ThreadResolutionWiring;
}
