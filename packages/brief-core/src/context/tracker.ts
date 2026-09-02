import { z } from "zod/v4";
import type { ValueOf } from "types";

export const TicketTrackers = {
  GITHUB: "github",
  NOTION: "notion",
} as const;
export type TicketTracker = ValueOf<typeof TicketTrackers>;

export const ReferenceLocations = {
  DESCRIPTION: "description",
  TITLE: "title",
  BRANCH: "branch",
} as const;
export type ReferenceLocation = ValueOf<typeof ReferenceLocations>;

/** Key prefixes are short identifier words; anything else refuses the block. */
const KEY_PREFIX = /^[A-Za-z][A-Za-z0-9_]{0,19}$/;
/** Notion hands out ids bare (URL) or dashed (the "Copy data source ID" button). */
const NOTION_ID =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The `tracker:` block of `.mergebrief/settings.yaml`. Keys match only the
 * configured prefix; a `github` tracker adds nothing but where a bare `#N`
 * resolves. `databaseId` takes the board's database id or its data source
 * id; the provider resolves either.
 */
export const TrackerConfigSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(TicketTrackers.NOTION),
      keyPrefix: z.string().regex(KEY_PREFIX),
      databaseId: z
        .string()
        .regex(NOTION_ID)
        .transform((id) => id.replaceAll("-", "")),
    })
    .strict(),
  z
    .object({
      kind: z.literal(TicketTrackers.GITHUB),
      issuesRepo: z.string().regex(OWNER_REPO).optional(),
    })
    .strict(),
]);
export type TrackerConfig = z.infer<typeof TrackerConfigSchema>;
