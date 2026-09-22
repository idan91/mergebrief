// The Inbox on the wire: one numbered page of the viewer's pull requests
// across every installation they reach plus their own url rows, with the
// review-state counts, the viewer and the reachable installations beside it.
import type {
  GenerationFailureCode,
  GenerationFailureParams,
  GenerationStatus,
  PrState,
  PullRequestSource,
} from "persistence";
import type { InboxReviewState } from "types/inbox";
import type { ValueOf } from "types/utils";
import type { GenerationPhase } from "./generation";
import type { ViewerView } from "./viewer";

/** The query keys a client sends; the values are the maps in `types/inbox`. */
export const InboxQueryKeys = {
  PAGE: "page",
  SORT: "sort",
  STATE: "state",
  REPO: "repo",
  REVIEW: "review",
  AUTHOR: "author",
  INSTALLATION: "installation",
} as const;
export type InboxQueryKey = ValueOf<typeof InboxQueryKeys>;

/** One numbered page. A page past the end carries no items and the true total. */
export interface Page<Item> {
  readonly items: readonly Item[];
  /** One-based. */
  readonly page: number;
  readonly pageSize: number;
  /** Rows matching the filters across every page. */
  readonly total: number;
}

/** The generation projection's poll-relevant slice, as the PR meta reports it. */
export interface InboxGenerationView {
  readonly status: GenerationStatus;
  readonly phase: GenerationPhase | null;
  readonly attempts: number;
  readonly errorCode: GenerationFailureCode | null;
  readonly errorParams: GenerationFailureParams | null;
  readonly updatedAt: string;
}

/** Where the pull request sat in its stack when the latest brief was generated. */
export interface InboxStackView {
  /** One-based position in the chain. */
  readonly index: number;
  readonly size: number;
}

export interface InboxItem {
  /** Stringified: GitHub repo ids exceed JSON's safe-integer comfort zone. */
  readonly repoId: string;
  readonly repoSlug: string | null;
  readonly prNumber: number;
  readonly title: string | null;
  readonly state: PrState;
  readonly draft: boolean;
  readonly source: PullRequestSource;
  /** Stringified; null for a url row. */
  readonly installationId: string | null;
  readonly viewerIsAuthor: boolean;
  /** Null for the viewer's own pull requests. */
  readonly reviewState: InboxReviewState | null;
  /** GitHub reports a head the latest brief does not cover. */
  readonly behind: boolean;
  /** GitHub stopped showing the row to its owner; url rows only. */
  readonly unreachable: boolean;
  readonly generation: InboxGenerationView | null;
  readonly latestBriefAt: string | null;
  readonly githubUpdatedAt: string | null;
  /** From the latest brief's stored snapshot; null when it sat in no chain. */
  readonly stack: InboxStackView | null;
}

/** The four review-state totals over every viewable row, unfiltered. */
export interface InboxCountsView {
  readonly new: number;
  readonly inProgress: number;
  readonly reviewed: number;
  readonly updated: number;
}

export interface ReachableInstallationView {
  /** Stringified. */
  readonly installationId: string;
  readonly accountLogin: string;
}

export interface InboxResponse extends Page<InboxItem> {
  readonly counts: InboxCountsView;
  readonly viewer: ViewerView;
  readonly reachableInstallations: readonly ReachableInstallationView[];
}
