import { z } from "zod/v4";
import { TicketTrackers } from "types/trackers";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";

/** Key prefixes are short identifier words; anything else refuses the block. */
const KEY_PREFIX = /^[A-Za-z][A-Za-z0-9_]{0,19}$/;
/** Notion hands out ids bare (URL) or dashed (the "Copy data source ID" button). */
const NOTION_ID =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * One tracker entry, the same shape in the instance config's `trackers:`
 * and a repo's `settings.yaml`. Keys match only the configured prefix; a
 * `github` entry adds nothing but where a bare `#N` resolves. `databaseId`
 * takes the board's database id or its data source id.
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

/** A deployment rarely spans more boards than this; the cap bounds the scan per location. */
export const MAX_TRACKERS = 8;

/** `trackers:`, one entry per board, so an organization with several boards names every prefix. */
export const TrackerListSchema = z
  .array(TrackerConfigSchema)
  .min(1)
  .max(MAX_TRACKERS);

/** The two spellings a settings file may carry; `resolveTrackerConfigs` reads either. */
export interface TrackerSettings {
  readonly tracker?: TrackerConfig | undefined;
  readonly trackers?: readonly TrackerConfig[] | undefined;
}

/** Zero-config default: no board, so keys never match and GitHub is the tracker. */
export const DEFAULT_TRACKERS: readonly TrackerConfig[] = [];

/** The trackers as one list, whichever spelling the file used; empty when it named none. */
export function resolveTrackerConfigs(
  settings: TrackerSettings | undefined,
): TrackerConfig[] {
  if (settings === undefined) {
    return [];
  }
  if (settings.trackers !== undefined) {
    return [...settings.trackers];
  }
  if (settings.tracker !== undefined) {
    return [settings.tracker];
  }
  return [];
}

/**
 * The trackers a generation runs with: the repo's own when its settings
 * name any, else the instance's. A repo file replaces the instance list
 * whole; the two never merge, so a repo can narrow as well as widen.
 */
export function resolveEffectiveTrackers(
  settings: TrackerSettings | undefined,
  instance: readonly TrackerConfig[],
): TrackerConfig[] {
  const own = resolveTrackerConfigs(settings);
  return own.length > 0 ? own : [...instance];
}

/**
 * The rules one list must hold, run on every schema that carries it: one
 * spelling per file, one GitHub entry, and no prefix on two boards, since
 * a key can resolve on only one.
 */
export function refineTrackerSettings(
  settings: TrackerSettings,
  context: z.RefinementCtx,
): void {
  if (settings.tracker !== undefined && settings.trackers !== undefined) {
    context.addIssue({
      code: "custom",
      message: "use either tracker or trackers, not both",
      path: ["trackers"],
    });
    return;
  }
  const trackers = resolveTrackerConfigs(settings);
  const seenPrefixes = new Set<string>();
  let githubEntries = 0;

  for (const [index, tracker] of trackers.entries()) {
    if (tracker.kind === TicketTrackers.GITHUB) {
      githubEntries += 1;
      if (githubEntries > 1) {
        context.addIssue({
          code: "custom",
          message: "at most one github tracker",
          path: ["trackers", index],
        });
      }
      continue;
    }
    const prefix = tracker.keyPrefix.toUpperCase();
    if (seenPrefixes.has(prefix)) {
      context.addIssue({
        code: "custom",
        message: `keyPrefix ${tracker.keyPrefix} names two boards`,
        path: ["trackers", index, "keyPrefix"],
      });
    }
    seenPrefixes.add(prefix);
  }
}

const trackersBlockSchema = z
  .object({ trackers: TrackerListSchema })
  .superRefine(refineTrackerSettings);

/** Parse the instance config's raw `trackers` root value; issues name fields, never values. */
export function validateTrackersBlock(
  block: unknown,
): Result<TrackerConfig[], ConfigError> {
  const parsed = trackersBlockSchema.safeParse({ trackers: block });
  if (parsed.success) {
    return { ok: true, value: parsed.data.trackers };
  }

  return configError(
    parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
    ),
  );
}
