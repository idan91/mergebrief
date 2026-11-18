import { z } from "zod/v4";
import type { Mutable, Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./readRoot";

/**
 * The instance `updateCheck` block: the api's hourly fetch of the release
 * manifest. `url` is checked as text only here; the api, which fetches it,
 * refuses one that is not an http(s) URL.
 */
export interface UpdateCheckSettings {
  readonly enabled: boolean;
  /** A mirror of the manifest; absent means the project's own. */
  readonly url?: string;
}

export const DEFAULT_UPDATE_CHECK_SETTINGS: UpdateCheckSettings = {
  enabled: true,
};

const updateCheckBlockSchema = z.strictObject({
  enabled: z.boolean("must be true or false").optional(),
  url: z.string("must be a URL").optional(),
});

/** Parse a raw `updateCheck` root value; a key never echoes a pasted credential. */
export function validateUpdateCheckBlock(
  block: unknown,
): Result<UpdateCheckSettings, ConfigError> {
  const parsed = updateCheckBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        if (issue.code === "unrecognized_keys") {
          return `updateCheck: unrecognized key${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map(renderKey)
            .join(", ")}`;
        }
        const path = issue.path.map(String).join(".");
        const where = path.length > 0 ? `${path}: ` : "";
        return `updateCheck: ${where}${issue.message}`;
      }),
    );
  }

  const settings: Mutable<UpdateCheckSettings> = {
    enabled: parsed.data.enabled ?? DEFAULT_UPDATE_CHECK_SETTINGS.enabled,
  };
  if (parsed.data.url !== undefined) {
    settings.url = parsed.data.url;
  }
  return { ok: true, value: settings };
}
