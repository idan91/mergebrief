// The viewer, read off the session route: the cheapest answer that knows
// who is signed in, no GitHub call and no list behind it. A 401 is the
// signed-out state; anything else throws so react-query retries and refetches
// instead of holding a blip as an answer.
import { queryOptions } from "@tanstack/react-query";

import {
  apiFetch,
  apiJsonFromResponse,
  errorFromResponse,
} from "../../data/apiFetch";
import { parseViewer, ViewerStates, type ViewerState } from "./types";

const VIEWER_STALE_MS = 5 * 60_000;
const SESSION_PATH = "/api/auth/session";

export function buildViewerQueryOptions() {
  return queryOptions({
    queryKey: ["account", "viewer"],
    staleTime: VIEWER_STALE_MS,
    queryFn: async (): Promise<ViewerState> => {
      const response = await apiFetch(SESSION_PATH);
      if (response.status === 401) {
        return { kind: ViewerStates.SIGNED_OUT };
      }
      if (!response.ok) {
        throw await errorFromResponse(response, SESSION_PATH);
      }
      return parseViewer(await apiJsonFromResponse(response, SESSION_PATH));
    },
  });
}
