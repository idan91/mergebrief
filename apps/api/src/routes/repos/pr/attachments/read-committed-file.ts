import { HttpStatuses } from "types/http";
import type { Mutable, Result } from "types/utils";
import type { RepoAccess } from "../../../../access/types";
import { parseOwnerAndName } from "../../utils";
import { DOWNLOAD_URL_TTL_MS } from "./consts";
import { readCommittedFileMediaType } from "./logic/committed-media-type";
import { spendCommittedLookups } from "./logic/lookup-budget";
import {
  fetchCommittedFileBytes,
  fetchContentsDownloadUrl,
  fetchMatchingRefNames,
  type MatchingRefsInput,
} from "./logic/fetch-committed-file";
import { isVideoMediaType } from "./logic/media-type";
import { wrapBytesFailure, wrapDenial } from "./logic/read-failures";
import { resolveCommittedFileLocation } from "./logic/resolve-ref";
import { callWithViewerToken } from "./logic/viewer-token";
import {
  ReadAttachmentFailureKinds,
  type AttachmentBytes,
  type BytesReadOptions,
  type CommittedFileMediaType,
  type CommittedFileRequest,
  type CommittedLookupKey,
  type CommittedViewerKey,
  type ReadAttachmentFailure,
  type ReadCommittedFileDeps,
  type ReadCommittedFileInput,
  type UpstreamBytesRequest,
} from "./types";

type ReadResult = Result<AttachmentBytes, ReadAttachmentFailure>;

interface DownloadRequest {
  readonly file: CommittedFileRequest;
  readonly cacheKey: CommittedLookupKey;
  readonly declared: CommittedFileMediaType;
  readonly upstream: UpstreamBytesRequest;
}

const ASSET_ABSENT: Result<never, ReadAttachmentFailure> = {
  ok: false,
  error: { kind: ReadAttachmentFailureKinds.ASSET_ABSENT },
};

/** Each GitHub call spends the viewer's budget first; a spent budget answers like a missing file. */
function spendLookups(
  deps: ReadCommittedFileDeps,
  access: RepoAccess,
  cost: number,
): boolean {
  const reviewerId = String(access.session.reviewerId);
  const budget = deps.store.lookupBudget;
  return spendCommittedLookups(budget, reviewerId, cost, Date.now()).ok;
}

async function listRefNames(
  deps: ReadCommittedFileDeps,
  access: RepoAccess,
  query: MatchingRefsInput,
): Promise<Result<readonly string[], ReadAttachmentFailure>> {
  if (!spendLookups(deps, access, query.namespaces.length)) {
    return ASSET_ABSENT;
  }
  const listed = await callWithViewerToken(access.credential, (token) =>
    fetchMatchingRefNames(deps.fetch, token, query),
  );
  return wrapDenial(listed);
}

async function readFreshDownloadUrl(
  deps: ReadCommittedFileDeps,
  access: RepoAccess,
  request: DownloadRequest,
): Promise<Result<string, ReadAttachmentFailure>> {
  if (!spendLookups(deps, access, 1)) {
    return ASSET_ABSENT;
  }
  const fetched = await callWithViewerToken(access.credential, (token) =>
    fetchContentsDownloadUrl(
      deps.fetch,
      token,
      request.file,
      request.upstream.signal,
    ),
  );
  if (fetched.ok) {
    const expiresAt = Date.now() + DOWNLOAD_URL_TTL_MS;
    deps.store.downloadUrls.set(request.cacheKey, fetched.value, expiresAt);
  }
  return wrapDenial(fetched);
}

/** A video is always read in pieces; an image only when the client asked for a range. */
function buildUpstreamRequest(
  bytes: BytesReadOptions,
  declared: CommittedFileMediaType,
): UpstreamBytesRequest {
  const request: Mutable<UpstreamBytesRequest> = { signal: bytes.signal };
  const asksUpstreamRange = bytes.rangeRequested || isVideoMediaType(declared);
  if (asksUpstreamRange) {
    request.range = bytes.upstreamRange;
  }
  return request;
}

/** A 404 at the download may be an expired address: one fresh `download_url`, one more fetch. */
async function readDownload(
  deps: ReadCommittedFileDeps,
  access: RepoAccess,
  request: DownloadRequest,
): Promise<ReadResult> {
  let downloadUrl = deps.store.downloadUrls.get(request.cacheKey);
  if (downloadUrl === undefined) {
    const fresh = await readFreshDownloadUrl(deps, access, request);
    if (!fresh.ok) {
      return fresh;
    }
    downloadUrl = fresh.value;
  }

  const first = await fetchCommittedFileBytes(
    deps.fetch,
    downloadUrl,
    request.declared,
    request.upstream,
  );
  if (first.ok || first.error.status !== HttpStatuses.NOT_FOUND) {
    return wrapBytesFailure(first);
  }

  deps.store.downloadUrls.delete(request.cacheKey);
  const refetched = await readFreshDownloadUrl(deps, access, request);
  if (!refetched.ok) {
    return refetched;
  }
  const second = await fetchCommittedFileBytes(
    deps.fetch,
    refetched.value,
    request.declared,
    request.upstream,
  );
  return wrapBytesFailure(second);
}

/**
 * A committed image or video in the gated repository, streamed. Every GitHub request
 * rides the viewer's own token and the bytes fetch none, so a file the
 * viewer cannot read on GitHub is never served, whatever pass the gate took.
 */
export async function readCommittedFile(
  deps: ReadCommittedFileDeps,
  access: RepoAccess,
  input: ReadCommittedFileInput,
): Promise<ReadResult> {
  const repo = parseOwnerAndName(access.repoFullName);
  const declared = readCommittedFileMediaType(input.pathSegments);
  if (repo === undefined || declared === undefined) {
    return ASSET_ABSENT;
  }

  const viewerKey: CommittedViewerKey = `${access.session.sessionTokenHash}:${String(access.repoId)}`;
  const location = await resolveCommittedFileLocation(deps.store.refs, {
    viewerKey,
    signal: input.bytes.signal,
    pathSegments: input.pathSegments,
    listRefs: (query) => listRefNames(deps, access, { ...repo, ...query }),
  });
  if (!location.ok) {
    return location;
  }

  const file = { ...repo, ...location.value };
  const filePath = JSON.stringify([file.ref, ...file.fileSegments]);
  const cacheKey: CommittedLookupKey = `${viewerKey}:${filePath}`;
  const upstream = buildUpstreamRequest(input.bytes, declared);
  return readDownload(deps, access, { file, cacheKey, declared, upstream });
}
