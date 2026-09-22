import type { ValueOf } from "./utils";

/** The viewer's review state on a pull request's latest Brief; the viewer's own rows carry none. */
export const InboxReviewStates = {
  NEW: "new",
  IN_PROGRESS: "in-progress",
  REVIEWED: "reviewed",
  UPDATED: "updated",
} as const;
export type InboxReviewState = ValueOf<typeof InboxReviewStates>;

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
