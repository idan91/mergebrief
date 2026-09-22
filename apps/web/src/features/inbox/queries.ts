// The Inbox's queryOptions door: one numbered page over the isomorphic
// `apiFetch` boundary, so the Home loader prefetches it through the same
// authz gate the browser meets. A 401 is the signed-out Home, not a failure.
// The list never polls; a window focus re-reads it.
import { queryOptions } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  apiJsonFromResponse,
  errorFromResponse,
} from "../../data/apiFetch";
import { INBOX_QUERY_ROOT } from "./consts";
import { parseInboxResponse } from "./schemas";
import { InboxStates, type InboxQueryParams, type InboxState } from "./types";
import { buildInboxSearch } from "./utils";

const INBOX_PATH = "/api/inbox";
const INBOX_STALE_MS = 15_000;

export function buildInboxQueryOptions(params: InboxQueryParams) {
  const search = buildInboxSearch(params);
  const path = `${INBOX_PATH}${search}`;
  return queryOptions({
    queryKey: [INBOX_QUERY_ROOT, search],
    staleTime: INBOX_STALE_MS,
    queryFn: async (): Promise<InboxState> => {
      const response = await apiFetch(path);
      if (response.status === 401) return { kind: InboxStates.SIGNED_OUT };
      if (!response.ok) throw await errorFromResponse(response, path);

      const parsed = parseInboxResponse(
        await apiJsonFromResponse(response, path),
      );
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
      }
      return { kind: InboxStates.READY, page: parsed.value };
    },
  });
}

/** The owner delete of one url row; true once the API confirmed it is gone. */
export async function deleteInboxItem(
  repoId: string,
  prNumber: number,
): Promise<boolean> {
  const path = `${INBOX_PATH}/${encodeURIComponent(repoId)}/${String(prNumber)}`;
  const response = await apiFetch(path, { method: "DELETE" });
  return response.ok;
}
