import type {
  InboxAuthorFilter,
  InboxReviewState,
  InboxSort,
  InboxStatus,
} from "types/inbox";
import type { ValueOf } from "types/utils";
import type { z } from "zod/v4";

import type {
  inboxCountsSchema,
  inboxGenerationSchema,
  inboxItemSchema,
  inboxResponseSchema,
} from "./schemas";

/** What the Inbox query answers; a 401 is the signed-out Home, never a failure. */
export const InboxStates = {
  READY: "ready",
  SIGNED_OUT: "signed-out",
} as const;

export type InboxPage = z.infer<typeof inboxResponseSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxCounts = z.infer<typeof inboxCountsSchema>;
export type InboxGeneration = z.infer<typeof inboxGenerationSchema>;

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

export type InboxState =
  | { readonly kind: typeof InboxStates.READY; readonly page: InboxPage }
  | { readonly kind: typeof InboxStates.SIGNED_OUT };

/** The list's parameters as the route holds them; each key is one of the wire's. */
export interface InboxQueryParams {
  readonly page?: number;
  readonly sort?: InboxSort;
  readonly state?: readonly InboxStatus[];
  readonly repo?: readonly string[];
  readonly review?: readonly InboxReviewState[];
  readonly author?: InboxAuthorFilter;
  readonly installation?: readonly string[];
}
