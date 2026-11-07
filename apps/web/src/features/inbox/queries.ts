// The Inbox's queryOptions door: one numbered page over the isomorphic
// `apiFetch` boundary, so the Home loader prefetches it through the same
// authz gate the browser meets. A 401 is the signed-out Home and any other
// refusal is the failed list, both answers rather than throws, so the page
// keeps its header and URL box. The list never polls; a window focus
// re-reads it, at once after a failure.
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ProductActionIds, ProductOperations, ProductQueryIds } from "contract";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  apiJsonFromResponse,
  readWireCode,
  SIGNED_OUT_READ,
} from "../../data/apiFetch";
import { readFailureKind, request } from "../../data/request";
import type { WriteKindTable } from "../../data/request/types";
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

const INBOX_PATH = ProductOperations[ProductQueryIds.LIST_INBOX].path;
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

/** The inbox's state for these params as cached now, without a read; absent before the first. */
export function readCachedInboxKind(
  queryClient: QueryClient,
  params: InboxQueryParams,
): InboxState["kind"] | undefined {
  return queryClient.getQueryData(buildInboxQueryOptions(params).queryKey)
    ?.kind;
}

type ArchiveFailureKind = Exclude<
  ArchivePullResult["kind"],
  typeof RowWriteResultKinds.ARCHIVED | typeof RowWriteResultKinds.UNARCHIVED
>;
type PurgeFailureKind = Exclude<
  PurgeAttachmentsResult["kind"],
  typeof RowWriteResultKinds.PURGED
>;

const DeleteKinds: WriteKindTable<RowWriteFailureKind> = {
  [ApiErrorCodes.FORBIDDEN]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.GITHUB_PERMISSION]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.SCOPE_EXCEEDED]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.HUMAN_ONLY]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: RowWriteResultKinds.FORBIDDEN,
  [ApiErrorCodes.NOT_FOUND]: RowWriteResultKinds.NOT_FOUND,
  fallback: RowWriteResultKinds.FAILED,
};

const PurgeKinds: WriteKindTable<PurgeFailureKind> = {
  ...DeleteKinds,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: RowWriteResultKinds.DISABLED,
  [ApiErrorCodes.GITHUB_PERMISSION]: RowWriteResultKinds.APP_PERMISSION,
};

// An archive only ever touches the viewer's own Inbox, so a refusal reads as
// a plain failure.
const ArchiveKinds: WriteKindTable<ArchiveFailureKind> = {
  [ApiErrorCodes.NOT_FOUND]: RowWriteResultKinds.NOT_FOUND,
  fallback: RowWriteResultKinds.FAILED,
};

/** The owner-only purge of one pasted row: no GitHub call, so an unreadable repository still lets it go. */
export async function deleteOwnPull(
  repoId: string,
  prNumber: number,
): Promise<DeletePullResult> {
  try {
    await request(ProductActionIds.DELETE_OWN_PULL, {
      params: { repoId, prNumber },
    });
    return { kind: RowWriteResultKinds.DELETED };
  } catch (error) {
    return { kind: readFailureKind(error, DeleteKinds) };
  }
}

/** The gated delete of a repository's whole attachments branch. */
export async function purgeAttachments(
  repoId: string,
): Promise<PurgeAttachmentsResult> {
  try {
    await request(ProductActionIds.PURGE_ATTACHMENTS, {
      params: { repoId },
      unauthorizedLeavesForSignIn: true,
    });
    return { kind: RowWriteResultKinds.PURGED };
  } catch (error) {
    return { kind: readFailureKind(error, PurgeKinds) };
  }
}

/** The gated delete of one pull request's briefs. */
export async function deletePull(
  repoId: string,
  prNumber: number,
): Promise<DeletePullResult> {
  try {
    await request(ProductActionIds.DELETE_PULL, {
      params: { repoId, prNumber },
      unauthorizedLeavesForSignIn: true,
    });
    return { kind: RowWriteResultKinds.DELETED };
  } catch (error) {
    return { kind: readFailureKind(error, DeleteKinds) };
  }
}

/** Put the row out of the viewer's Inbox until a new brief lands. */
export async function archivePull(
  repoId: string,
  prNumber: number,
): Promise<ArchivePullResult> {
  try {
    await request(ProductActionIds.ARCHIVE_PULL, {
      params: { repoId, prNumber },
      unauthorizedLeavesForSignIn: true,
    });
    return { kind: RowWriteResultKinds.ARCHIVED };
  } catch (error) {
    return { kind: readFailureKind(error, ArchiveKinds) };
  }
}

/** Bring an archived row back to the viewer's Inbox. */
export async function unarchivePull(
  repoId: string,
  prNumber: number,
): Promise<ArchivePullResult> {
  try {
    await request(ProductActionIds.UNARCHIVE_PULL, {
      params: { repoId, prNumber },
      unauthorizedLeavesForSignIn: true,
    });
    return { kind: RowWriteResultKinds.UNARCHIVED };
  } catch (error) {
    return { kind: readFailureKind(error, ArchiveKinds) };
  }
}
