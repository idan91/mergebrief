import { InboxQueryKeys } from "contract";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxGenerationFilters,
  InboxReviewStates,
  InboxSortDirections,
  InboxSorts,
  InboxStatuses,
  InboxLayouts,
} from "types/inbox";
import { z } from "zod/v4";
import {
  MAX_INBOX_FILTER_VALUES,
  MAX_INBOX_PAGE,
  MAX_INBOX_SEARCH_TEXT_LENGTH,
  installationIdSchema,
  repoIdSchema,
} from "../wire-bounds";

const DEFAULT_STATUSES = [InboxStatuses.OPEN, InboxStatuses.DRAFT];

function buildListSchema<Schema extends z.ZodType>(schema: Schema) {
  return z.array(schema).max(MAX_INBOX_FILTER_VALUES).optional();
}

/** Trimmed and cut to the bound; text with nothing left in it is no search at all. */
function shapeSearchText(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  // By whole characters, so the cut never leaves half of a surrogate pair.
  const characters = Array.from(trimmed).slice(0, MAX_INBOX_SEARCH_TEXT_LENGTH);
  const kept = characters.join("").trimEnd();
  return kept === "" ? undefined : kept;
}

/** Every key is optional on the wire; the defaults are the Inbox's opening view. */
export const inboxQuerySchema = z.object({
  [InboxQueryKeys.PAGE]: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_INBOX_PAGE)
    .default(1),
  [InboxQueryKeys.SORT]: z.enum(InboxSorts).default(InboxSorts.UPDATED),
  [InboxQueryKeys.DIRECTION]: z
    .enum(InboxSortDirections)
    .default(InboxSortDirections.DESCENDING),
  [InboxQueryKeys.LAYOUT]: z.enum(InboxLayouts).default(InboxLayouts.FOLDED),
  [InboxQueryKeys.STATE]: z
    .array(z.enum(InboxStatuses))
    .max(MAX_INBOX_FILTER_VALUES)
    .default(DEFAULT_STATUSES),
  [InboxQueryKeys.REPO]: buildListSchema(repoIdSchema),
  [InboxQueryKeys.REVIEW]: buildListSchema(z.enum(InboxReviewStates)),
  [InboxQueryKeys.AUTHOR]: z
    .enum(InboxAuthorFilters)
    .default(InboxAuthorFilters.ALL),
  [InboxQueryKeys.INSTALLATION]: buildListSchema(installationIdSchema),
  [InboxQueryKeys.ARCHIVED]: z
    .enum(InboxArchivedFilters)
    .default(InboxArchivedFilters.HIDE),
  [InboxQueryKeys.GENERATION]: z.enum(InboxGenerationFilters).optional(),
  [InboxQueryKeys.SEARCH_TEXT]: z
    .string()
    .optional()
    .transform(shapeSearchText),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;
