// Two fetchers. An asset's rendered URL needs no credential: a private one
// carries GitHub's own short-lived signature, a public one answers 302 to S3
// for anyone, so that fetch sends no Authorization header and a token never
// rides to S3. A branch file is a Contents API read and carries the viewer's
// token; node's fetch drops the header on the cross-origin redirect.
import { ATTACHMENT_BRANCH } from "contract";
import type {
  GitHubApiError,
  GitHubCallFailure,
  ReviewerCredential,
} from "github";
import type { Mutable, Result } from "types/utils";
import {
  CONTENTS_RAW_MEDIA_TYPE,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  IDENTITY_CODING,
  UPSTREAM_HEADERS_TIMEOUT_MS,
  VIDEO_SNIFF_BYTES,
} from "../consts";
import type {
  AttachmentBytes,
  ReadBranchAttachmentInput,
  UpstreamBytesRequest,
} from "../types";
import { fetchWithHeadersDeadline } from "./fetch-upstream";
import { isVideoMediaType, readAssetMediaType } from "./media-type";
import { readStreamHead } from "./peek-stream";
import { sniffVideoMediaType } from "./sniff-video";
import {
  buildNotAnImageError,
  buildStatusError,
  buildTransportError,
  isUnreadablePiece,
  readByteExtent,
  readMediaType,
} from "./upstream-response";
import { callWithViewerToken } from "./viewer-token";

const CONTEXT = "user attachment";
const JSON_MEDIA_TYPE = "application/json";
const ASSET_ACCEPT = "image/*, video/*";

type BytesResult = Result<AttachmentBytes, GitHubApiError>;

function buildUpstreamHeaders(
  request: UpstreamBytesRequest,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: ASSET_ACCEPT,
    "accept-encoding": IDENTITY_CODING,
  };
  if (request.range !== undefined) {
    headers["range"] = request.range;
  }
  return headers;
}

/**
 * A video piece holding the file's first bytes must carry a video signature,
 * so a page or a text file named by the upstream type is refused there; a
 * later piece holds no signature to read.
 */
async function confirmVideoHead(bytes: AttachmentBytes): Promise<BytesResult> {
  if (bytes.extent !== undefined && bytes.extent.first !== 0) {
    return { ok: true, value: bytes };
  }
  let peeked;
  try {
    peeked = await readStreamHead(bytes.body, VIDEO_SNIFF_BYTES);
  } catch {
    return { ok: false, error: buildTransportError(CONTEXT) };
  }
  if (sniffVideoMediaType(peeked.head) === undefined) {
    await peeked.body.cancel();
    return { ok: false, error: buildNotAnImageError(CONTEXT) };
  }
  return { ok: true, value: { ...bytes, body: peeked.body } };
}

/**
 * The asset's bytes, served under the allowlisted type upstream names: a
 * raster, or a video whose head carries a video signature.
 */
export async function fetchAttachmentBytes(
  fetchImpl: typeof fetch,
  sourceUrl: string,
  request: UpstreamBytesRequest,
): Promise<BytesResult> {
  let response: Response;
  try {
    response = await fetchWithHeadersDeadline(fetchImpl, sourceUrl, {
      init: {
        method: "GET",
        redirect: "follow",
        headers: buildUpstreamHeaders(request),
      },
      signal: request.signal,
      timeoutMs: UPSTREAM_HEADERS_TIMEOUT_MS,
    });
  } catch {
    return { ok: false, error: buildTransportError(CONTEXT) };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: buildStatusError(CONTEXT, response.status) };
  }

  const contentType = readAssetMediaType(readMediaType(response));
  const unservable = contentType === undefined || isUnreadablePiece(response);
  if (unservable || response.body === null) {
    await response.body?.cancel();
    return { ok: false, error: buildNotAnImageError(CONTEXT) };
  }

  const bytes: Mutable<AttachmentBytes> = { body: response.body, contentType };
  const extent = readByteExtent(response);
  if (extent !== undefined) {
    bytes.extent = extent;
  }
  if (isVideoMediaType(contentType)) {
    return confirmVideoHead(bytes);
  }
  return { ok: true, value: bytes };
}

function buildContentsUrl(input: ReadBranchAttachmentInput): URL {
  const { owner, repo, file } = input;
  const url = new URL(
    `/repos/${owner}/${repo}/contents/${file.fileName}`,
    GITHUB_API_ORIGIN,
  );
  url.searchParams.set("ref", ATTACHMENT_BRANCH);
  return url;
}

/**
 * The contents endpoint answers a file's bytes under `vnd.github.raw`, never
 * the image's own type, so the served type is the one the file name
 * declares; the branch admits only allowlisted names. A directory at the
 * path answers a JSON listing, which is no image.
 */
export async function fetchBranchAttachmentBytes(
  fetchImpl: typeof fetch,
  accessToken: string,
  input: ReadBranchAttachmentInput,
  signal: AbortSignal,
): Promise<Result<AttachmentBytes, GitHubApiError>> {
  let response: Response;
  try {
    response = await fetchWithHeadersDeadline(
      fetchImpl,
      buildContentsUrl(input),
      {
        init: {
          method: "GET",
          redirect: "follow",
          headers: {
            accept: CONTENTS_RAW_MEDIA_TYPE,
            authorization: `Bearer ${accessToken}`,
            "x-github-api-version": GITHUB_API_VERSION,
          },
        },
        signal,
        timeoutMs: UPSTREAM_HEADERS_TIMEOUT_MS,
      },
    );
  } catch {
    return { ok: false, error: buildTransportError(CONTEXT) };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: buildStatusError(CONTEXT, response.status) };
  }
  if (readMediaType(response) === JSON_MEDIA_TYPE || response.body === null) {
    await response.body?.cancel();
    return { ok: false, error: buildNotAnImageError(CONTEXT) };
  }

  return {
    ok: true,
    value: { body: response.body, contentType: input.file.mediaType },
  };
}

/**
 * A branch file on the viewer's own token, renewed once on a 401. Never on
 * the operator PAT: its pass is granted per pull request and a branch file
 * is tied to none, so borrowing it would serve any file on the branch.
 */
export function readBranchAttachment(
  fetchImpl: typeof fetch,
  credential: ReviewerCredential,
  input: ReadBranchAttachmentInput,
  signal: AbortSignal,
): Promise<Result<AttachmentBytes, GitHubCallFailure>> {
  return callWithViewerToken(credential, (token) =>
    fetchBranchAttachmentBytes(fetchImpl, token, input, signal),
  );
}
