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
      if (response.status === 401) {
        return { kind: InboxStates.SIGNED_OUT };
      }
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

/** How a row write was refused: a refusal to act, a row that is gone, or anything else. */
export type RowWriteFailureKind = "forbidden" | "not-found" | "failed";

export type DeletePullResult =
  | { kind: "deleted" }
  /** 403: not a repository admin, or a Bearer principal on a human-only act. */
  | { kind: RowWriteFailureKind };

export type ArchivePullResult =
  | { kind: "archived" }
  | { kind: "unarchived" }
  | { kind: Exclude<RowWriteFailureKind, "forbidden"> };

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
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: "forbidden",
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: "forbidden",
  [ApiErrorCodes.NOT_FOUND]: "not-found",
  [ApiErrorCodes.INVALID_REQUEST]: "failed",
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: "failed",
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
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: "failed",
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: "failed",
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: "failed",
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: "failed",
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
} as const satisfies Record<ApiErrorCode, RowWriteFailureKind>;

function buildPullPath(repoId: string, prNumber: number): string {
  return `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}`;
}

async function readRowWriteFailure(
  response: Response,
  path: string,
): Promise<RowWriteFailureKind> {
  const { code } = await errorFromResponse(response, path);
  return KindForCode[code];
}

/** The owner-only purge of one pasted row: no GitHub call, so an unreadable repository still lets it go. */
export async function deleteOwnPull(
  repoId: string,
  prNumber: number,
): Promise<DeletePullResult> {
  const path = `/api/inbox/${encodeURIComponent(repoId)}/${String(prNumber)}`;
  const response = await apiFetch(path, { method: "DELETE" });
  if (!response.ok) {
    return { kind: await readRowWriteFailure(response, path) };
  }
  return { kind: "deleted" };
}

export type PurgeAttachmentsResult =
  | { kind: "purged" }
  /** A rule on the branch refuses the App: the admin's move is on GitHub. */
  | { kind: "disabled" }
  /** The App's own permission is short: Contents kept read-only, or an archived repository. */
  | { kind: "app-permission" }
  /** 403: not a repository admin, or a Bearer principal on a human-only act. */
  | { kind: RowWriteFailureKind };

/** The gated delete of a repository's whole attachments branch. */
export async function purgeAttachments(
  repoId: string,
): Promise<PurgeAttachmentsResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/attachments`;
  const response = await apiFetch(path, { method: "DELETE" });
  if (response.ok) {
    return { kind: "purged" };
  }
  const { code } = await errorFromResponse(response, path);
  if (code === ApiErrorCodes.ATTACHMENTS_DISABLED) {
    return { kind: "disabled" };
  }
  if (code === ApiErrorCodes.GITHUB_PERMISSION) {
    return { kind: "app-permission" };
  }
  return { kind: KindForCode[code] };
}

/** The gated delete of one pull request's briefs. */
export async function deletePull(
  repoId: string,
  prNumber: number,
): Promise<DeletePullResult> {
  const path = buildPullPath(repoId, prNumber);
  const response = await apiFetch(path, { method: "DELETE" });
  if (!response.ok) {
    return { kind: await readRowWriteFailure(response, path) };
  }
  return { kind: "deleted" };
}

async function writeArchive(
  repoId: string,
  prNumber: number,
  method: "PUT" | "DELETE",
  done: "archived" | "unarchived",
): Promise<ArchivePullResult> {
  const path = `${buildPullPath(repoId, prNumber)}/archive`;
  const response = await apiFetch(path, { method });
  if (!response.ok) {
    const kind = await readRowWriteFailure(response, path);
    return { kind: kind === "forbidden" ? "failed" : kind };
  }
  return { kind: done };
}

/** Put the row out of the viewer's Inbox until a new brief lands. */
export function archivePull(
  repoId: string,
  prNumber: number,
): Promise<ArchivePullResult> {
  return writeArchive(repoId, prNumber, "PUT", "archived");
}

/** Bring an archived row back to the viewer's Inbox. */
export function unarchivePull(
  repoId: string,
  prNumber: number,
): Promise<ArchivePullResult> {
  return writeArchive(repoId, prNumber, "DELETE", "unarchived");
}
