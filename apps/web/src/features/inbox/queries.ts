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
  SIGNED_OUT_READ,
  type ApiErrorCode,
} from "../../data/apiFetch";
import { INBOX_QUERY_ROOT } from "./consts";
import { parseInboxResponse } from "./schemas";
import {
  InboxStates,
  RowWriteResultKinds,
  type ArchivePullResult,
  type DeletePullResult,
  type InboxQueryParams,
  type InboxState,
  type PurgeAttachmentsResult,
  type RowWriteFailureKind,
} from "./types";
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
      const response = await apiFetch(path, SIGNED_OUT_READ);
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

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "failed".
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.SIGNED_OUT]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.INVALID_SIGNATURE]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.FORBIDDEN]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.GITHUB_PERMISSION]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.SCOPE_EXCEEDED]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.HUMAN_ONLY]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.NOT_FOUND]: RowWriteResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.NOT_A_PR_URL]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.SIGN_IN_FAILED]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.DIFF_TOO_LARGE]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.FILE_NOT_FOUND]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.FILE_TOO_LARGE]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.FILE_NOT_TEXT]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.PENDING_REVIEW_HELD]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.ARTIFACT_UNREADABLE]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.INTERNAL_ERROR]: RowWriteResultKinds.FAILED,
  [ApiErrorCodes.MALFORMED]: RowWriteResultKinds.FAILED,
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
  return { kind: RowWriteResultKinds.DELETED };
}

/** The gated delete of a repository's whole attachments branch. */
export async function purgeAttachments(
  repoId: string,
): Promise<PurgeAttachmentsResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/attachments`;
  const response = await apiFetch(path, {
    method: "DELETE",
    unauthorizedLeavesForSignIn: true,
  });
  if (response.ok) {
    return { kind: RowWriteResultKinds.PURGED };
  }
  const { code } = await errorFromResponse(response, path);
  if (code === ApiErrorCodes.ATTACHMENTS_DISABLED) {
    return { kind: RowWriteResultKinds.DISABLED };
  }
  if (code === ApiErrorCodes.GITHUB_PERMISSION) {
    return { kind: RowWriteResultKinds.APP_PERMISSION };
  }
  return { kind: KindForCode[code] };
}

/** The gated delete of one pull request's briefs. */
export async function deletePull(
  repoId: string,
  prNumber: number,
): Promise<DeletePullResult> {
  const path = buildPullPath(repoId, prNumber);
  const response = await apiFetch(path, {
    method: "DELETE",
    unauthorizedLeavesForSignIn: true,
  });
  if (!response.ok) {
    return { kind: await readRowWriteFailure(response, path) };
  }
  return { kind: RowWriteResultKinds.DELETED };
}

async function writeArchive(
  repoId: string,
  prNumber: number,
  method: "PUT" | "DELETE",
  done:
    | typeof RowWriteResultKinds.ARCHIVED
    | typeof RowWriteResultKinds.UNARCHIVED,
): Promise<ArchivePullResult> {
  const path = `${buildPullPath(repoId, prNumber)}/archive`;
  const response = await apiFetch(path, {
    method,
    unauthorizedLeavesForSignIn: true,
  });
  if (!response.ok) {
    const kind = await readRowWriteFailure(response, path);
    return {
      kind:
        kind === RowWriteResultKinds.FORBIDDEN
          ? RowWriteResultKinds.FAILED
          : kind,
    };
  }
  return { kind: done };
}

/** Put the row out of the viewer's Inbox until a new brief lands. */
export function archivePull(
  repoId: string,
  prNumber: number,
): Promise<ArchivePullResult> {
  return writeArchive(repoId, prNumber, "PUT", RowWriteResultKinds.ARCHIVED);
}

/** Bring an archived row back to the viewer's Inbox. */
export function unarchivePull(
  repoId: string,
  prNumber: number,
): Promise<ArchivePullResult> {
  return writeArchive(
    repoId,
    prNumber,
    "DELETE",
    RowWriteResultKinds.UNARCHIVED,
  );
}
