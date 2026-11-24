import type { ValueOf } from "types/utils";

export interface Author {
  readonly login: string;
  readonly isBot: boolean;
}

export interface ThreadComment {
  readonly id: number;
  readonly author: Author | undefined;
  readonly createdAt: string;
  readonly path: string;
  readonly line: number | undefined;
}

export interface ReviewThread {
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly comments: readonly ThreadComment[];
}

export interface Review {
  readonly id: number;
  readonly author: Author | undefined;
  readonly state: string;
  readonly submittedAt: string | undefined;
  /** Inline comments the review carried; a thread reply arrives as a one-comment review. */
  readonly commentIds: readonly number[];
}

export interface IssueComment {
  readonly id: number;
  readonly author: Author | undefined;
  readonly createdAt: string;
}

/** One PR as GitHub reports it, trimmed to what the stack status reads. */
export interface PullSnapshot {
  readonly number: number;
  readonly state: string;
  readonly isDraft: boolean;
  readonly head: string;
  readonly base: string;
  readonly headSha: string;
  /** The earlier of the head's commit time and its first check suite (its push). */
  readonly activitySince: string;
  /** More review threads exist than one page returned. */
  readonly threadsTruncated: boolean;
  readonly reviews: readonly Review[];
  readonly issueComments: readonly IssueComment[];
  readonly threads: readonly ReviewThread[];
}

export interface OpenThread {
  readonly rootId: number;
  readonly path: string;
  readonly line: number | undefined;
  readonly lastAuthor: string;
  readonly lastAt: string;
  readonly isOutdated: boolean;
}

export const ActivityKinds = {
  REVIEW: "review",
  COMMENT: "comment",
} as const;
export type ActivityKind = ValueOf<typeof ActivityKinds>;

export interface Activity {
  readonly kind: ActivityKind;
  readonly author: string;
  readonly at: string;
  readonly state?: string;
}

export interface PullStatus {
  readonly pull: PullSnapshot;
  readonly isOpen: boolean;
  /** Whether the base branch is an ancestor of the head; absent for closed PRs. */
  readonly baseAligned?: boolean;
  readonly openThreads: readonly OpenThread[];
  readonly activityAfterHead: readonly Activity[];
}

/** The main checkout the maintainer watches. */
export interface Checkout {
  readonly branch: string | undefined;
  readonly headSha: string;
  readonly isDirty: boolean;
}

export interface StackStatus {
  readonly pulls: readonly PullStatus[];
  readonly checkout: Checkout;
  /** The highest open PR, which the main checkout is meant to track. */
  readonly top: PullSnapshot | undefined;
}

/** Runs one CLI process and reports its outcome without throwing. */
export type CommandRunner = (args: readonly string[]) => CommandOutcome;

export interface CommandOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}
