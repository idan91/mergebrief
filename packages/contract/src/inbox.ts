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
  LAYOUT: "layout",
  STATE: "state",
  REPO: "repo",
  REVIEW: "review",
  AUTHOR: "author",
  INSTALLATION: "installation",
  ARCHIVED: "archived",
} as const;
export type InboxQueryKey = ValueOf<typeof InboxQueryKeys>;

/** The bounds both sides hold, so the client drops what the API would refuse. */
export const InboxQueryBounds = {
  PAGE_SIZE: 25,
  /** Values one multi-valued filter may carry. */
  MAX_FILTER_VALUES: 100,
  /** The last page whose offset still fits Postgres's int4 at PAGE_SIZE rows. */
  MAX_PAGE: 85_899_345,
} as const;

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
  /**
   * The viewer may delete this pull request's briefs: their own url row, or
   * an installation row whose repository GitHub says they administer.
   */
  readonly viewerCanDelete: boolean;
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

/** The four review-state totals over the open, non-draft, unarchived rows the viewer can see, whatever the filters or the view. */
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

/** One repository the rows in view name; the Repository filter lists these, unfiltered. */
export interface InboxRepositoryView {
  /** Stringified. */
  readonly repoId: string;
  readonly repoSlug: string | null;
}

export interface InboxResponse extends Page<InboxItem> {
  /** The viewer's archived rows, whatever the filters or the view, so an empty page can say how many there are. */
  readonly archivedTotal: number;
  readonly counts: InboxCountsView;
  readonly viewer: ViewerView;
  readonly reachableInstallations: readonly ReachableInstallationView[];
  /** Sorted by slug, each once, capped by the store; the Repository filter's whole vocabulary. */
  readonly repositories: readonly InboxRepositoryView[];
  /** Where a viewer installs the App; null only when the API was composed without a slug. */
  readonly installUrl: string | null;
}
