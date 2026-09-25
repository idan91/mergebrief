import { InboxQueryKeys } from "contract";
import { isInstallationId, isRepoId } from "persistence";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxReviewStates,
  InboxSorts,
  InboxStatuses,
  InboxLayouts,
} from "types/inbox";
import { z } from "zod";
import {
  MAX_INBOX_FILTER_VALUES,
  MAX_INBOX_PAGE,
  MAX_ROW_ID,
} from "../wire-bounds";

const DEFAULT_STATUSES = [InboxStatuses.OPEN, InboxStatuses.DRAFT];

function brandId<Id extends bigint>(
  guard: (value: bigint) => value is Id,
  label: string,
) {
  return z
    .string()
    .regex(/^[0-9]{1,19}$/, `${label} must be an id`)
    .transform((raw, ctx) => {
      const value = BigInt(raw);
      if (value > MAX_ROW_ID || !guard(value)) {
        ctx.addIssue({ code: "custom", message: `${label} out of range` });
        return z.NEVER;
      }
      return value;
    });
}

const repoIdSchema = brandId(isRepoId, "repo");
const installationIdSchema = brandId(isInstallationId, "installation");

function buildListSchema<Schema extends z.ZodTypeAny>(schema: Schema) {
  return z.array(schema).max(MAX_INBOX_FILTER_VALUES).optional();
}

/** Every key is optional on the wire; the defaults are the Inbox's opening view. */
export const inboxQuerySchema = z.object({
  [InboxQueryKeys.PAGE]: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_INBOX_PAGE)
    .default(1),
  [InboxQueryKeys.SORT]: z.nativeEnum(InboxSorts).default(InboxSorts.UPDATED),
  [InboxQueryKeys.LAYOUT]: z
    .nativeEnum(InboxLayouts)
    .default(InboxLayouts.FOLDED),
  [InboxQueryKeys.STATE]: z
    .array(z.nativeEnum(InboxStatuses))
    .max(MAX_INBOX_FILTER_VALUES)
    .default(DEFAULT_STATUSES),
  [InboxQueryKeys.REPO]: buildListSchema(repoIdSchema),
  [InboxQueryKeys.REVIEW]: buildListSchema(z.nativeEnum(InboxReviewStates)),
  [InboxQueryKeys.AUTHOR]: z
    .nativeEnum(InboxAuthorFilters)
    .default(InboxAuthorFilters.ALL),
  [InboxQueryKeys.INSTALLATION]: buildListSchema(installationIdSchema),
  [InboxQueryKeys.ARCHIVED]: z
    .nativeEnum(InboxArchivedFilters)
    .default(InboxArchivedFilters.HIDE),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;
