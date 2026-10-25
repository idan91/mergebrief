// The parsed conversation: the contract's shapes, with the vocabulary fields a
// newer server may extend read open. GitHub state names differ from Review
// Session dispositions; linked-comment bridges them.
import type {
  ConversationResponse,
  ConversationReviewView,
  ConversationThreadView,
  MentionTeamView,
} from "contract";
import type {
  ReviewCommentSide,
  ReviewVerdictState,
  ThreadSubjectType,
  ValueOf,
} from "types";

import type {
  MentionTeamCandidate,
  MentionUserCandidate,
} from "@web/components/MarkdownTextarea/types";
import type { UnknownValue } from "@web/utils/open-enum/types";

import type { PostedComment } from "../../data/postedComment";
import { WriteFailureKinds } from "../../data/request/types";

/** A thread chip's GitHub state; outdated wins over resolved. */
export const ThreadStates = {
  OPEN: "open",
  RESOLVED: "resolved",
  OUTDATED: "outdated",
} as const;
export type ThreadState = ValueOf<typeof ThreadStates>;

/** The element a thread row renders as: a list item, or a block where the host is no list. */
export const ThreadRowElements = {
  LIST_ITEM: "li",
  BLOCK: "div",
} as const;
export type ThreadRowElement = ValueOf<typeof ThreadRowElements>;

/** An unknown side or subject type cannot be placed: the thread renders unanchored. */
export interface ConversationThread extends Omit<
  ConversationThreadView,
  "side" | "startSide" | "subjectType"
> {
  readonly side?: ReviewCommentSide | UnknownValue;
  readonly startSide?: ReviewCommentSide | UnknownValue;
  readonly subjectType: ThreadSubjectType | UnknownValue;
}

/** An unknown state renders without a verdict chip. */
export interface ConversationReview extends Omit<
  ConversationReviewView,
  "state"
> {
  readonly state: ReviewVerdictState | UnknownValue;
}

export interface PrConversation extends Omit<
  ConversationResponse,
  "threads" | "reviews"
> {
  readonly threads: readonly ConversationThread[];
  readonly reviews: readonly ConversationReview[];
}

export const ReplyResultKinds = {
  POSTED: "posted",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  NOT_FOUND: "not-found",
  INVALID: "invalid",
  NO_WRITE_ACCESS: "no-write-access",
  UPSTREAM: "upstream",
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
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
  | { readonly kind: typeof ReplyResultKinds.UPSTREAM }
  /** A network throw, the proxy's 504 or an unreadable 2xx: it may have posted. */
  | { readonly kind: typeof ReplyResultKinds.INDETERMINATE };

export const ResolveThreadResultKinds = {
  DONE: "done",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  GITHUB_PERMISSION: "github-permission",
  NOT_FOUND: "not-found",
  INVALID: "invalid",
  NO_WRITE_ACCESS: "no-write-access",
  UPSTREAM: "upstream",
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
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
  | { readonly kind: typeof ResolveThreadResultKinds.UPSTREAM }
  /** A network throw, the proxy's 504, or a body that is unreadable or echoes the other direction. */
  | { readonly kind: typeof ResolveThreadResultKinds.INDETERMINATE };

/** A person GitHub offers for a mention; a bad avatar reads as absent. */
export interface MentionSuggestionUser {
  readonly login: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

/** The people and teams GitHub offers the viewer for one query. */
export interface GitHubMentionSuggestions {
  readonly users: readonly MentionSuggestionUser[];
  readonly teams: readonly MentionTeamView[];
}

export const MentionSearchResultKinds = {
  READY: "ready",
  /**
   * 401/404/502/503, all expected: the list falls back to participants, and
   * posting the comment is what surfaces a dead sign-in.
   */
  UNAVAILABLE: "unavailable",
} as const;

/** One search's answer; `query` is the lowercased text it answers. */
export type MentionSearchResult =
  | {
      readonly kind: typeof MentionSearchResultKinds.READY;
      readonly query: string;
      readonly users: readonly MentionUserCandidate[];
      readonly teams: readonly MentionTeamCandidate[];
    }
  | {
      readonly kind: typeof MentionSearchResultKinds.UNAVAILABLE;
      readonly query: string;
    };

/**
 * Where a composer's mention suggestions come from. Without `repoId` (the
 * local demo path) only the participants are offered.
 */
export interface MentionSource {
  readonly repoId?: string;
  readonly participants: readonly MentionUserCandidate[];
}
