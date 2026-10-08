import {
  type InboxArchivedFilter,
  type InboxAuthorFilter,
  type InboxReviewState,
  type InboxSort,
  type InboxStatus,
  type InboxLayout,
} from "types/inbox";
import type { ValueOf } from "types/utils";
import type { z } from "zod/v4";

import type { ApiErrorCode } from "../../data/apiFetch";

import type {
  inboxCountsSchema,
  inboxGenerationSchema,
  inboxItemSchema,
  inboxRepositorySchema,
  inboxResponseSchema,
} from "./schemas";

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

export type InboxPage = z.infer<typeof inboxResponseSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxCounts = z.infer<typeof inboxCountsSchema>;
export type InboxGeneration = z.infer<typeof inboxGenerationSchema>;
export type InboxRepository = z.infer<typeof inboxRepositorySchema>;

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
} as const;
export type RowWriteResultKind = ValueOf<typeof RowWriteResultKinds>;

/** How a row write was refused: a refusal to act, a row that is gone, or anything else. */
export type RowWriteFailureKind = Extract<
  RowWriteResultKind,
  | typeof RowWriteResultKinds.FORBIDDEN
  | typeof RowWriteResultKinds.NOT_FOUND
  | typeof RowWriteResultKinds.FAILED
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
