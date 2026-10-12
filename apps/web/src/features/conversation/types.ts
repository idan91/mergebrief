// Mirrors the JSON conversation contract: optional keys are absent, never null.
// GitHub state names differ from Review Session dispositions; linked-comment bridges them.
import type { ValueOf } from "types/utils";
import type { PostedComment } from "../../data/postedComment";

/** GitHub's diff-side wire values (same literals as the submit mapper). */
export const ThreadSides = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type ThreadSide = ValueOf<typeof ThreadSides>;

export const ThreadSubjectTypes = {
  LINE: "LINE",
  FILE: "FILE",
} as const;
export type ThreadSubjectType = ValueOf<typeof ThreadSubjectTypes>;

/** The element a thread row renders as: a list item, or a block where the host is no list. */
export const ThreadRowElements = {
  LIST_ITEM: "li",
  BLOCK: "div",
} as const;
export type ThreadRowElement = ValueOf<typeof ThreadRowElements>;

/** Submitted-review states; PENDING never crosses the API (drafts skipped). */
export const ReviewVerdictStates = {
  COMMENTED: "COMMENTED",
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  DISMISSED: "DISMISSED",
} as const;
export type ReviewVerdictState = ValueOf<typeof ReviewVerdictStates>;

export interface ConversationAuthor {
  readonly login: string;
  readonly isBot: boolean;
  /**
   * GitHub-CDN avatar; absent for ghost authors and https-gated at the
   * parse boundary (it lands in an `<img src>`): any value that is not an
   * https string drops the field, never the author.
   */
  readonly avatarUrl?: string;
}

export interface ConversationComment {
  readonly commentId: number;
  readonly author: ConversationAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
  /** The formal review this comment belongs to, the own-comment join key. */
  readonly reviewId?: number;
}

export interface ConversationThread {
  /** Thread identity AND the reply POST's target comment id. */
  readonly rootCommentId: number;
  readonly path: string;
  /** END line on the current diff; absent for outdated/file-level threads. */
  readonly line?: number;
  readonly startLine?: number;
  readonly side?: ThreadSide;
  readonly startSide?: ThreadSide;
  readonly subjectType: ThreadSubjectType;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  /** Anchor-time commit, the revision label for outdated threads. */
  readonly anchorSha?: string;
  readonly comments: readonly ConversationComment[];
  readonly hasMoreComments: boolean;
}

export interface ConversationReview {
  readonly reviewId: number;
  readonly author: ConversationAuthor;
  readonly state: ReviewVerdictState;
  readonly body: string;
  readonly submittedAt?: string;
  readonly url: string;
}

export interface PrLevelComment {
  readonly commentId: number;
  readonly author: ConversationAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
}

export interface PrConversation {
  readonly threads: readonly ConversationThread[];
  readonly reviews: readonly ConversationReview[];
  readonly prComments: readonly PrLevelComment[];
  readonly hasMoreThreads: boolean;
  readonly hasMoreReviews: boolean;
  readonly hasMorePrComments: boolean;
}

export const ReplyResultKinds = {
  POSTED: "posted",
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not-found",
  INVALID: "invalid",
  NO_WRITE_ACCESS: "no-write-access",
  UPSTREAM: "upstream",
} as const;
export type ReplyResultKind = ValueOf<typeof ReplyResultKinds>;

export type ReplyResult =
  | PostedComment
  /** 401: session expired; sign in again. Draft stays. */
  | { readonly kind: typeof ReplyResultKinds.UNAUTHORIZED }
  /** 404: the thread's root comment (or the PR) is gone. */
  | { readonly kind: typeof ReplyResultKinds.NOT_FOUND }
  /** 400 (shape; mirrored client-side) or deterministic 413, edit the body, retry-as-is never clears. */
  | { readonly kind: typeof ReplyResultKinds.INVALID }
  /**
   * 403: the reader is on a url-box brief for a repo their own GitHub
   * account cannot write to. Never a retry: it clears by installing the App
   * on that repository, not by trying again.
   */
  | { readonly kind: typeof ReplyResultKinds.NO_WRITE_ACCESS }
  /** 502/anything else: GitHub rejected or is unreachable. */
  | { readonly kind: typeof ReplyResultKinds.UPSTREAM };

export const ResolveThreadResultKinds = {
  DONE: "done",
  UNAUTHORIZED: "unauthorized",
  GITHUB_PERMISSION: "github-permission",
  NOT_FOUND: "not-found",
  INVALID: "invalid",
  NO_WRITE_ACCESS: "no-write-access",
  UPSTREAM: "upstream",
} as const;
export type ResolveThreadResultKind = ValueOf<typeof ResolveThreadResultKinds>;

export type ResolveThreadResult =
  /**
   * The thread is in the requested state, a fresh flip or a converged one
   * (`alreadyInTargetState`). Both are success and share the refetch path;
   * the flag exists so copy can stay honest if it ever needs to differ.
   */
  | {
      readonly kind: typeof ResolveThreadResultKinds.DONE;
      readonly resolved: boolean;
      readonly alreadyInTargetState: boolean;
    }
  /** 401: session expired; sign in again. */
  | { readonly kind: typeof ResolveThreadResultKinds.UNAUTHORIZED }
  /** 403: GitHub refused the mutation (permissions changed under the viewer). */
  | { readonly kind: typeof ResolveThreadResultKinds.GITHUB_PERMISSION }
  /** 404: the thread (or the PR) is gone. */
  | { readonly kind: typeof ResolveThreadResultKinds.NOT_FOUND }
  /** 400: the route rejected the shape (unreachable from valid UI state). */
  | { readonly kind: typeof ResolveThreadResultKinds.INVALID }
  /**
   * 403: a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { readonly kind: typeof ResolveThreadResultKinds.NO_WRITE_ACCESS }
  /** 502/anything else: GitHub rejected or is unreachable. */
  | { readonly kind: typeof ResolveThreadResultKinds.UPSTREAM };
