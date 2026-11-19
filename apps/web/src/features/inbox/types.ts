import type {
  GenerationFailureCode,
  GenerationStatus,
  InboxArchivedFilter,
  InboxAuthorFilter,
  InboxLayout,
  InboxReviewState,
  InboxSort,
  InboxSortDirection,
  InboxStatus,
  PrState,
  PullRequestSource,
  ValueOf,
} from "types";

import type { SignInFailure } from "contract";
import type { ApiErrorCode } from "../../data/apiFetch";
import { WriteFailureKinds } from "../../data/request/types";
import type { UnknownValue } from "@web/utils/open-enum/types";

/**
 * What the Inbox query answers: a 401 is the signed-out Home and any other
 * refusal is the failed list, so neither throws past the route.
 */
export const InboxStates = {
  READY: "ready",
  SIGNED_OUT: "signed-out",
  FAILED: "failed",
} as const;

/** Which side did not answer, named from the wire code. */
export const FailureSides = {
  GITHUB: "github",
  SERVER: "server",
} as const;
export type FailureSide = ValueOf<typeof FailureSides>;

export interface InboxGeneration {
  status: GenerationStatus | UnknownValue;
  /** A failed generation's code; absent otherwise, or for a code this bundle predates. */
  errorCode?: GenerationFailureCode;
  updatedAt: string;
}

/** The row's place in its stack, 1-based. */
export interface InboxStackPosition {
  index: number;
  size: number;
}

export interface InboxItem {
  repoId: string;
  repoSlug?: string;
  prNumber: number;
  title?: string;
  state: PrState | UnknownValue;
  draft: boolean;
  source: PullRequestSource | UnknownValue;
  installationId?: string;
  /** Absent when GitHub sent no user. */
  authorLogin?: string;
  viewerIsAuthor: boolean;
  viewerCanDelete: boolean;
  reviewState?: InboxReviewState | UnknownValue;
  behind: boolean;
  unreachable: boolean;
  generation?: InboxGeneration;
  latestBriefAt?: string;
  githubUpdatedAt?: string;
  /** GitHub's creation time; absent until the server has read it. */
  githubCreatedAt?: string;
  stack?: InboxStackPosition;
}

export interface InboxCounts {
  new: number;
  inProgress: number;
  reviewed: number;
  updated: number;
}

export interface InboxViewer {
  login?: string;
  avatarUrl: string;
}

export interface ReachableInstallation {
  installationId: string;
  accountLogin: string;
}

export interface InboxRepository {
  repoId: string;
  repoSlug?: string;
}

export interface InboxPage {
  items: InboxItem[];
  page: number;
  pageSize: number;
  total: number;
  archivedTotal: number;
  /** Rows the search text matches, whatever the filters or the view; 0 without search text. */
  searchMatchTotal: number;
  /** The rows of `searchMatchTotal` the viewer archived. */
  archivedSearchMatchTotal: number;
  counts: InboxCounts;
  viewer: InboxViewer;
  reachableInstallations: ReachableInstallation[];
  repositories: InboxRepository[];
  installUrl?: string;
}

export const AgeUnits = {
  MINUTES: "minutes",
  HOURS: "hours",
  YESTERDAY: "yesterday",
  DAYS: "days",
  DATE: "date",
} as const;
export type AgeUnit = ValueOf<typeof AgeUnits>;

export const TitleSegmentKinds = {
  TEXT: "text",
  CODE: "code",
} as const;
export type TitleSegmentKind = ValueOf<typeof TitleSegmentKinds>;

/** What stands where the rows would: rows, or one of three reasons there are none. */
export const InboxEmptinesses = {
  ROWS: "rows",
  /** No viewable row in any status. */
  EMPTY: "empty",
  /** Rows exist, the reviewer's filters match none. */
  FILTERED: "filtered",
  /** Rows of the view exist, every one merged or closed, no filter set. */
  HIDDEN_BY_DEFAULT: "hidden-by-default",
  /** The archived view, and nothing is archived. */
  ARCHIVED_ONLY: "archived-only",
  /** No unarchived row in any status; the viewer archived every one. */
  ALL_ARCHIVED: "all-archived",
} as const;
export type InboxEmptiness = ValueOf<typeof InboxEmptinesses>;

/** Why a search shows no rows. */
export const SearchMissKinds = {
  /** Rows of the view on screen match; the other filters hide them. */
  HIDDEN_BY_FILTERS: "hidden-by-filters",
  /** Only the other view, archived or not, holds a match. */
  IN_OTHER_VIEW: "in-other-view",
  /** No row the reviewer reaches matches. */
  NOWHERE: "nowhere",
} as const;
export type SearchMissKind = ValueOf<typeof SearchMissKinds>;

/** Why a search shows no rows; a kind that points at matches counts them. */
export type SearchMissReason =
  | {
      readonly kind: Exclude<SearchMissKind, typeof SearchMissKinds.NOWHERE>;
      readonly count: number;
    }
  | { readonly kind: typeof SearchMissKinds.NOWHERE };

export type InboxState =
  | { readonly kind: typeof InboxStates.READY; readonly page: InboxPage }
  | { readonly kind: typeof InboxStates.SIGNED_OUT }
  | { readonly kind: typeof InboxStates.FAILED; readonly code: ApiErrorCode };

/** The list's parameters as the route holds them; each key is one of the wire's. */
export interface InboxQueryParams {
  readonly page?: number;
  readonly sort?: InboxSort;
  readonly direction?: InboxSortDirection;
  readonly layout?: InboxLayout;
  readonly state?: readonly InboxStatus[];
  readonly repo?: readonly string[];
  readonly review?: readonly InboxReviewState[];
  readonly author?: InboxAuthorFilter;
  readonly installation?: readonly string[];
  readonly archived?: InboxArchivedFilter;
  /** The search text, trimmed and within the wire's bound. */
  readonly q?: string;
}

/**
 * The list's state as the URL carries it: each multi-valued filter is one
 * comma-joined string, so the address reads as words and repeats no key.
 */
export interface InboxSearch {
  readonly page?: number;
  readonly sort?: InboxSort;
  /** Which way the sort runs; absent is newest first. */
  readonly direction?: InboxSortDirection;
  readonly layout?: InboxLayout;
  readonly state?: string;
  readonly repo?: string;
  readonly review?: string;
  readonly author?: InboxAuthorFilter;
  readonly installation?: string;
  readonly archived?: InboxArchivedFilter;
  /** The search text; whole digits ride as a number so the router prints them bare. */
  readonly q?: string | number;
  /** Why the last sign-in failed; only a signed-out Home carries it. */
  readonly error?: SignInFailure;
}

/**
 * The search text someone other than the search field put in place, which
 * the field takes at once: Clear empties it, and a Back, a Forward or a link
 * carries its target's. The URL on screen cannot say so while that target is
 * still loading, or when it holds the text the URL already showed.
 */
export interface SearchTextOverride {
  /** Steps on each one, so the same text twice still registers. */
  readonly count: number;
  readonly text: string;
}

/** A change to the URL's state; an explicit `undefined` unsets a key. */
export type InboxSearchChange = {
  readonly [Key in keyof InboxSearch]?: InboxSearch[Key] | undefined;
};

export interface FilterOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
}

export const RowWriteResultKinds = {
  DELETED: "deleted",
  ARCHIVED: "archived",
  UNARCHIVED: "unarchived",
  PURGED: "purged",
  DISABLED: "disabled",
  APP_PERMISSION: "app-permission",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not-found",
  FAILED: "failed",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
} as const;
export type RowWriteResultKind = ValueOf<typeof RowWriteResultKinds>;

/** How a row write was refused: a refusal to act, a row that is gone, a refused session, no answer at all, or anything else. */
export type RowWriteFailureKind = Extract<
  RowWriteResultKind,
  | typeof RowWriteResultKinds.FORBIDDEN
  | typeof RowWriteResultKinds.NOT_FOUND
  | typeof RowWriteResultKinds.FAILED
  | typeof RowWriteResultKinds.UNAUTHORIZED
  | typeof RowWriteResultKinds.INDETERMINATE
>;

export type DeletePullResult =
  | { kind: typeof RowWriteResultKinds.DELETED }
  /** 403: not a repository admin, or a Bearer principal on a human-only act. */
  | { kind: RowWriteFailureKind };

export type ArchivePullResult =
  | { kind: typeof RowWriteResultKinds.ARCHIVED }
  | { kind: typeof RowWriteResultKinds.UNARCHIVED }
  | {
      kind: Exclude<RowWriteFailureKind, typeof RowWriteResultKinds.FORBIDDEN>;
    };

export type PurgeAttachmentsResult =
  | { kind: typeof RowWriteResultKinds.PURGED }
  /** A rule on the branch refuses the App: the admin's move is on GitHub. */
  | { kind: typeof RowWriteResultKinds.DISABLED }
  /** The App's own permission is short: Contents kept read-only, or an archived repository. */
  | { kind: typeof RowWriteResultKinds.APP_PERMISSION }
  /** 403: not a repository admin, or a Bearer principal on a human-only act. */
  | { kind: RowWriteFailureKind };
