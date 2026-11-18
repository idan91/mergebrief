import type { LoadedInstancePolicy } from "generators/instance-policy";
import { isHttpUrl } from "persistence";
import type { Result } from "types/utils";
import { ConfigErrorCodes, type ConfigError } from "../config";
import { DEFAULT_UPDATE_CHECK_URL } from "../update-check/consts";

const UPDATE_CHECK_URL_NOT_HTTP =
  "updateCheck.url: must be an absolute http(s) URL without credentials";

export interface UpdateCheckSource {
  /** Whether the api fetches the release manifest at all. */
  readonly enabled: boolean;
  readonly url: string;
}

/** The instance config's `updateCheck` block as the check reads it, the project's own manifest when no mirror is named. */
export function resolveUpdateCheckSource(
  settings: LoadedInstancePolicy["updateCheck"],
): Result<UpdateCheckSource, ConfigError> {
  const url = settings.url ?? DEFAULT_UPDATE_CHECK_URL;
  if (!isHttpUrl(url)) {
    return {
      ok: false,
      error: {
        code: ConfigErrorCodes.INVALID,
        issues: [UPDATE_CHECK_URL_NOT_HTTP],
      },
    };
  }

  return { ok: true, value: { enabled: settings.enabled, url } };
}
