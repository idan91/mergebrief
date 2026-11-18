import type { ValueOf } from "./utils";

/** The viewer's review state on a pull request's latest Brief; the viewer's own rows carry none. */
export const InboxReviewStates = {
  NEW: "new",
  IN_PROGRESS: "in-progress",
  REVIEWED: "reviewed",
  UPDATED: "updated",
} as const;
export type InboxReviewState = ValueOf<typeof InboxReviewStates>;

/** The review states the fold lifts: the reviewer still owes the row work. */
export const InboxFoldStates = {
  NEW: InboxReviewStates.NEW,
  UPDATED: InboxReviewStates.UPDATED,
  IN_PROGRESS: InboxReviewStates.IN_PROGRESS,
} as const;
export type InboxFoldState = ValueOf<typeof InboxFoldStates>;

/** The status filter's values: a draft is an open pull request marked draft. */
export const InboxStatuses = {
  OPEN: "open",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const;
export type InboxStatus = ValueOf<typeof InboxStatuses>;

export const InboxSorts = {
  /** By GitHub's `updated_at`, the default. */
  UPDATED: "updated",
  /** By the latest Brief's creation time. */
  GENERATED: "generated",
} as const;
export type InboxSort = ValueOf<typeof InboxSorts>;

export const InboxAuthorFilters = {
  MINE: "mine",
  OTHERS: "others",
  ALL: "all",
} as const;
export type InboxAuthorFilter = ValueOf<typeof InboxAuthorFilters>;

/** The viewer's archived rows: hidden, the default, or the only rows listed. */
export const InboxArchivedFilters = {
  HIDE: "hide",
  ONLY: "only",
} as const;
export type InboxArchivedFilter = ValueOf<typeof InboxArchivedFilters>;

/** How the list is laid out: rows that need the reviewer first, or one list in the sort's order. */
export const InboxLayouts = {
  FOLDED: "folded",
  MIXED: "mixed",
} as const;
export type InboxLayout = ValueOf<typeof InboxLayouts>;
