// The Inbox on the wire: one numbered page of the viewer's pull requests
// across every installation they reach plus their own url rows, with the
// review-state counts, the viewer and the reachable installations beside it.
import type {
  InboxReviewState,
  PrState,
  PullRequestSource,
  ValueOf,
} from "types";
import type { GenerationSummaryView } from "./generation";
import type { ViewerView } from "./viewer";

/** The query keys a client sends; the values are the maps in `types/inbox`. */
export const InboxQueryKeys = {
  PAGE: "page",
  SORT: "sort",
  DIRECTION: "direction",
  LAYOUT: "layout",
  STATE: "state",
  REPO: "repo",
  REVIEW: "review",
  AUTHOR: "author",
  INSTALLATION: "installation",
  ARCHIVED: "archived",
  GENERATION: "generation",
  SEARCH_TEXT: "q",
} as const;
export type InboxQueryKey = ValueOf<typeof InboxQueryKeys>;

/** The bounds both sides hold, so the client drops what the API would refuse. */
export const InboxQueryBounds = {
  PAGE_SIZE: 25,
  /** Values one multi-valued filter may carry. */
  MAX_FILTER_VALUES: 100,
  /** The last page whose offset still fits Postgres's int4 at PAGE_SIZE rows. */
  MAX_PAGE: 85_899_345,
  /** Characters of search text kept; a longer value is cut, never refused. */
  MAX_SEARCH_TEXT_LENGTH: 100,
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
  /** The PR author's GitHub login; null when GitHub sent no user. */
  readonly authorLogin: string | null;
  readonly viewerIsAuthor: boolean;
  /**
   * The viewer may delete this pull request's briefs: their own url row, or
   * an installation row whose repository GitHub says they administer.
   */
  readonly viewerCanDelete: boolean;
  /**
   * GitHub says the viewer may push to an installation row's repository, as
   * the listing read it: the bar Generate now on a held head asks for. False
   * on a url row.
   */
  readonly viewerCanPush: boolean;
  /** Every push of this PR generates, trigger conditions or not; false on a url row. */
  readonly generateEveryPush: boolean;
  /** Null for the viewer's own pull requests. */
  readonly reviewState: InboxReviewState | null;
  /** GitHub reports a head the latest brief does not cover. */
  readonly behind: boolean;
  /** GitHub stopped showing the row to its owner; url rows only. */
  readonly unreachable: boolean;
  readonly generation: GenerationSummaryView | null;
  readonly latestBriefAt: string | null;
  readonly githubUpdatedAt: string | null;
  /** GitHub's creation time; null until an event or a live read carries it. */
  readonly githubCreatedAt: string | null;
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
  /** The viewer's rows the search text matches, whatever the filters or the view, so an empty page can say how many they hide; 0 without search text. */
  readonly searchMatchTotal: number;
  /** The rows of `searchMatchTotal` the viewer archived, so a miss can say which view holds the matches. */
  readonly archivedSearchMatchTotal: number;
  /** The rows of the view on screen whose head trigger conditions hold, under every filter but the generation one. */
  readonly heldTotal: number;
  readonly counts: InboxCountsView;
  readonly viewer: ViewerView;
  readonly reachableInstallations: readonly ReachableInstallationView[];
  /** Sorted by slug, each once, capped by the store; the Repository filter's whole vocabulary. */
  readonly repositories: readonly InboxRepositoryView[];
  /** Where a viewer installs the App; null only when the API was composed without a slug. */
  readonly installUrl: string | null;
}
