import type {
  GenerationStatus,
  InboxArchivedFilter,
  InboxAuthorFilter,
  InboxLayout,
  InboxReviewState,
  InboxSort,
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

export type InboxState =
  | { readonly kind: typeof InboxStates.READY; readonly page: InboxPage }
  | { readonly kind: typeof InboxStates.SIGNED_OUT }
  | { readonly kind: typeof InboxStates.FAILED; readonly code: ApiErrorCode };

/** The list's parameters as the route holds them; each key is one of the wire's. */
export interface InboxQueryParams {
  readonly page?: number;
  readonly sort?: InboxSort;
  readonly layout?: InboxLayout;
  readonly state?: readonly InboxStatus[];
  readonly repo?: readonly string[];
  readonly review?: readonly InboxReviewState[];
  readonly author?: InboxAuthorFilter;
  readonly installation?: readonly string[];
  readonly archived?: InboxArchivedFilter;
}

/**
 * The list's state as the URL carries it: each multi-valued filter is one
 * comma-joined string, so the address reads as words and repeats no key.
 */
export interface InboxSearch {
  readonly page?: number;
  readonly sort?: InboxSort;
  readonly layout?: InboxLayout;
  readonly state?: string;
  readonly repo?: string;
  readonly review?: string;
  readonly author?: InboxAuthorFilter;
  readonly installation?: string;
  readonly archived?: InboxArchivedFilter;
  /** Why the last sign-in failed; only a signed-out Home carries it. */
  readonly error?: SignInFailure;
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
