// The feature's queryOptions door, referenced by routes. The read goes through
// the isomorphic boundary; the switch is a client-only POST, after which the
// caller invalidates EVERYTHING — a tenant switch changes what every query is
// allowed to see.
import { queryOptions } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCode,
  apiFetchJson,
  errorFromResponse,
} from "../../data/apiFetch";
import { parseInstallationsView, type InstallationsView } from "./types";

export function installationsQueryOptions() {
  return queryOptions({
    queryKey: ["installations"],
    queryFn: async (): Promise<InstallationsView> => {
      const path = "/api/auth/installations";
      const body = await apiFetchJson(path);
      const parsed = parseInstallationsView(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: 60_000,
    retry: false,
  });
}

export interface SwitchInstallationInput {
  readonly installationId: string;
  readonly setDefault: boolean;
}

/**
 * Hard navigation to the picker after a switch: a tenant change invalidates
 * every piece of client state (queries, per-brief session stores), so a full
 * reload is the honest reset. Module-level so tests can stub it.
 */
export function reloadToPicker(): void {
  window.location.assign("/");
}

/** POST the switch; non-2xx throws a typed ApiError (403 = not accessible). */
export async function switchInstallation(
  input: SwitchInstallationInput,
): Promise<void> {
  const response = await fetch("/api/auth/installations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await errorFromResponse(response, "/api/auth/installations");
  }
}
