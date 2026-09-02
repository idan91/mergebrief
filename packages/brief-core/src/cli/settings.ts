import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";
import { TrackerConfigSchema, type TrackerConfig } from "../context/tracker";

/** The `.mergebrief/settings.yaml` path, relative to the working tree. */
export const LOCAL_SETTINGS_PATH = join(".mergebrief", "settings.yaml");

/**
 * The slice of `settings.yaml` the CLIs read locally. Version-gated like the
 * server schema, loose on the other keys: the worker's reject-whole gate is
 * the server's; this is the developer's own working tree.
 */
const localSettingsSchema = z
  .object({
    version: z.literal(1),
    tracker: TrackerConfigSchema.optional(),
  })
  .loose();

export interface LocalTrackerRead {
  readonly tracker: TrackerConfig | undefined;
  /** Why no tracker applies, when the file exists but did not parse. */
  readonly warning?: string;
}

/**
 * Read the `tracker:` block from the working tree's `settings.yaml`. An
 * absent file is the common case and is silent; an unreadable or invalid
 * file yields no tracker and one warning line.
 */
export function readLocalTracker(cwd: string): LocalTrackerRead {
  const path = join(cwd, LOCAL_SETTINGS_PATH);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { tracker: undefined };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return {
      tracker: undefined,
      warning: `${LOCAL_SETTINGS_PATH} is not valid YAML; no tracker applies`,
    };
  }
  const result = localSettingsSchema.safeParse(parsed);
  if (!result.success) {
    return {
      tracker: undefined,
      warning: `${LOCAL_SETTINGS_PATH} is invalid (${z.prettifyError(result.error).split("\n")[0] ?? "schema"}); no tracker applies`,
    };
  }
  return { tracker: result.data.tracker };
}
