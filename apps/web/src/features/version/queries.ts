// The release snapshot off `/api/version`: the server's version, the latest
// release it knows of and the viewer's dismissal. A 401 is the signed-out
// state; anything else throws so react-query retries instead of holding a
// blip as an answer. The read is cheap (a cached snapshot on the server), so
// it goes stale after a minute, refetches on focus, and polls once a minute
// while the page is visible and the viewer is signed in; the server's own
// hourly fetch bounds freshness.
import { queryOptions } from "@tanstack/react-query";

import {
  apiFetch,
  apiJsonFromResponse,
  errorFromResponse,
} from "../../data/apiFetch";
import { parseVersion } from "./schemas";
import { VersionStates, type VersionState } from "./types";
import { resolvePollInterval } from "./utils";

const VERSION_STALE_MS = 60_000;
const VERSION_PATH = "/api/version";

export function buildVersionQueryOptions() {
  return queryOptions({
    queryKey: ["version"],
    staleTime: VERSION_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => resolvePollInterval(query.state.data),
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<VersionState> => {
      const response = await apiFetch(VERSION_PATH);
      if (response.status === 401) {
        return { kind: VersionStates.SIGNED_OUT };
      }
      if (!response.ok) {
        throw await errorFromResponse(response, VERSION_PATH);
      }
      const parsed = parseVersion(
        await apiJsonFromResponse(response, VERSION_PATH),
      );
      if (!parsed.ok) {
        return { kind: VersionStates.UNKNOWN };
      }
      return { kind: VersionStates.KNOWN, snapshot: parsed.value };
    },
  });
}
