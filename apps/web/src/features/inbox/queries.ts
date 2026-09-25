// The Inbox's queryOptions door: one numbered page over the isomorphic
// `apiFetch` boundary, so the Home loader prefetches it through the same
// authz gate the browser meets. A 401 is the signed-out Home and any other
// refusal is the failed list, both answers rather than throws, so the page
// keeps its header and URL box. The list never polls; a window focus
// re-reads it, at once after a failure.
import { queryOptions } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  apiJsonFromResponse,
  errorFromResponse,
  readWireCode,
  type ApiErrorCode,
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
    staleTime: (query) =>
      query.state.data?.kind === InboxStates.FAILED ? 0 : INBOX_STALE_MS,
    queryFn: async (): Promise<InboxState> => {
      const response = await apiFetch(path);
      if (response.status === 401) return { kind: InboxStates.SIGNED_OUT };
      if (!response.ok) {
        // Only a code the API wrote names a side; a codeless answer is a
        // proxy speaking for a down server, never GitHub.
        const body: unknown = await response.json().catch(() => undefined);
        const code = readWireCode(body) ?? ApiErrorCodes.INTERNAL_ERROR;
        return { kind: InboxStates.FAILED, code };
      }

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

export type DeletePullResult =
  | { kind: "deleted" }
  /** 403: not a repository admin, or a Bearer principal on a human-only act. */
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "failed" };

type DeletePullFailureKind = Exclude<DeletePullResult["kind"], "deleted">;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "failed".
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: "failed",
  [ApiErrorCodes.INVALID_SIGNATURE]: "failed",
  [ApiErrorCodes.FORBIDDEN]: "forbidden",
  [ApiErrorCodes.GITHUB_PERMISSION]: "forbidden",
  [ApiErrorCodes.SCOPE_EXCEEDED]: "forbidden",
  [ApiErrorCodes.HUMAN_ONLY]: "forbidden",
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: "forbidden",
  [ApiErrorCodes.REPO_ADMIN_ONLY]: "forbidden",
  [ApiErrorCodes.NOT_FOUND]: "not-found",
  [ApiErrorCodes.INVALID_REQUEST]: "failed",
  [ApiErrorCodes.NOT_A_PR_URL]: "failed",
  [ApiErrorCodes.SIGN_IN_FAILED]: "failed",
  [ApiErrorCodes.REQUEST_TOO_LARGE]: "failed",
  [ApiErrorCodes.DIFF_TOO_LARGE]: "failed",
  [ApiErrorCodes.FILE_NOT_FOUND]: "failed",
  [ApiErrorCodes.FILE_TOO_LARGE]: "failed",
  [ApiErrorCodes.FILE_NOT_TEXT]: "failed",
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: "failed",
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: "failed",
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: "failed",
  [ApiErrorCodes.PENDING_REVIEW_HELD]: "failed",
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: "failed",
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: "failed",
  [ApiErrorCodes.APP_NOT_INSTALLED]: "failed",
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: "failed",
  [ApiErrorCodes.GENERATION_FAILED]: "failed",
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: "failed",
  [ApiErrorCodes.GENERATION_CONFIG]: "failed",
  [ApiErrorCodes.INTERNAL_ERROR]: "failed",
  [ApiErrorCodes.MALFORMED]: "failed",
} as const satisfies Record<ApiErrorCode, DeletePullFailureKind>;

/** The gated delete of one pull request's briefs. */
export async function deletePull(
  repoId: string,
  prNumber: number,
): Promise<DeletePullResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}`;
  const response = await apiFetch(path, { method: "DELETE" });
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    return { kind: KindForCode[code] };
  }
  return { kind: "deleted" };
}
