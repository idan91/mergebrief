// A committed file in the gated repository, read the way GitHub serves it to
// the viewer: the refs and the Contents API JSON on the viewer's token, then
// the `download_url` that JSON names, fetched with no credential. The raw
// media type would carry no `Range` support, so the bytes come from there.
import type { QualifiedRefNamespace } from "brief-core/media-address";
import { GitHubApiErrorCodes, type GitHubApiError } from "github";
import type { Mutable, Result } from "types/utils";
import { z } from "zod/v4";
import {
  CONTENTS_JSON_MEDIA_TYPE,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  GITHUB_JSON_TIMEOUT_MS,
  IDENTITY_CODING,
  RASTER_SNIFF_BYTES,
  RAW_DOWNLOAD_HOST,
  SVG_SNIFF_BYTES,
  UPSTREAM_HEADERS_TIMEOUT_MS,
  VIDEO_SNIFF_BYTES,
} from "../consts";
import {
  CommittedFileMediaTypes,
  type AttachmentBytes,
  type ByteExtent,
  type CommittedFileMediaType,
  type CommittedFileRequest,
  type CommittedRefQuery,
  type UpstreamBytesRequest,
} from "../types";
import { sniffCommittedMediaType } from "./committed-media-type";
import { fetchWithHeadersDeadline, runWithDeadline } from "./fetch-upstream";
import { isVideoMediaType } from "./media-type";
import { readStreamHead } from "./peek-stream";
import {
  buildStatusError,
  buildTransportError,
  isUnreadablePiece,
  readByteExtent,
} from "./upstream-response";

const CONTEXT = "committed file";
const REF_PREFIX = /^refs\/(heads|tags)\//;

const matchingRefsSchema = z.array(z.object({ ref: z.string() }));
const contentsFileSchema = z.object({
  type: z.literal("file"),
  download_url: z.string(),
});

export interface MatchingRefsInput extends CommittedRefQuery {
  readonly owner: string;
  readonly repo: string;
}

function buildUnexpectedError(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: `${CONTEXT}: unexpected response`,
  };
}

/** No status: a refused body is no expired address, so the caller never refetches for it. */
function buildNotServableError(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_FOUND,
    message: `${CONTEXT}: not a servable file`,
  };
}

function buildRepositoryPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function readGitHubJson(
  fetchImpl: typeof fetch,
  token: string,
  url: URL,
  signal: AbortSignal,
): Promise<Result<unknown, GitHubApiError>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: CONTENTS_JSON_MEDIA_TYPE,
        authorization: `Bearer ${token}`,
        "x-github-api-version": GITHUB_API_VERSION,
      },
      signal,
    });
  } catch {
    return { ok: false, error: buildTransportError(CONTEXT) };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: buildStatusError(CONTEXT, response.status) };
  }
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false, error: buildUnexpectedError() };
  }
}

/** Headers and body inside `GITHUB_JSON_TIMEOUT_MS`, and cancelled when `client` aborts. */
function requestGitHubJson(
  fetchImpl: typeof fetch,
  token: string,
  url: URL,
  client?: AbortSignal,
): Promise<Result<unknown, GitHubApiError>> {
  const deadline = { signal: client, timeoutMs: GITHUB_JSON_TIMEOUT_MS };
  return runWithDeadline(deadline, (signal) =>
    readGitHubJson(fetchImpl, token, url, signal),
  );
}

async function fetchNamespaceRefNames(
  fetchImpl: typeof fetch,
  token: string,
  input: MatchingRefsInput,
  namespace: QualifiedRefNamespace,
): Promise<Result<readonly string[], GitHubApiError>> {
  const repositoryPath = buildRepositoryPath(input.owner, input.repo);
  const prefix = encodeURIComponent(input.prefix);
  const url = new URL(
    `${repositoryPath}/git/matching-refs/${namespace}/${prefix}`,
    GITHUB_API_ORIGIN,
  );
  const answered = await requestGitHubJson(fetchImpl, token, url);
  if (!answered.ok) {
    return answered;
  }

  const parsed = matchingRefsSchema.safeParse(answered.value);
  if (!parsed.success) {
    return { ok: false, error: buildUnexpectedError() };
  }
  const names = parsed.data.map((entry) => entry.ref.replace(REF_PREFIX, ""));
  return { ok: true, value: names };
}

/**
 * The ref names starting with the segment, in each namespace asked. GitHub's
 * matching-refs takes one namespace per call, so heads and tags are two
 * calls at once. Several reads may wait on one lookup, so no client's signal
 * cancels it; only the deadline does.
 */
export async function fetchMatchingRefNames(
  fetchImpl: typeof fetch,
  token: string,
  input: MatchingRefsInput,
): Promise<Result<readonly string[], GitHubApiError>> {
  const answers = await Promise.all(
    input.namespaces.map((namespace) =>
      fetchNamespaceRefNames(fetchImpl, token, input, namespace),
    ),
  );
  const names: string[] = [];
  for (const answer of answers) {
    if (!answer.ok) {
      return answer;
    }
    names.push(...answer.value);
  }
  return { ok: true, value: names };
}

function isRawDownloadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === RAW_DOWNLOAD_HOST &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

/** The file's `download_url`, which for a private repository carries its own short-lived token. */
export async function fetchContentsDownloadUrl(
  fetchImpl: typeof fetch,
  token: string,
  file: CommittedFileRequest,
  client: AbortSignal,
): Promise<Result<string, GitHubApiError>> {
  const repositoryPath = buildRepositoryPath(file.owner, file.repo);
  const filePath = file.fileSegments.map(encodeURIComponent).join("/");
  const url = new URL(
    `${repositoryPath}/contents/${filePath}`,
    GITHUB_API_ORIGIN,
  );
  url.searchParams.set("ref", file.ref);
  const answered = await requestGitHubJson(fetchImpl, token, url, client);
  if (!answered.ok) {
    return answered;
  }

  const parsed = contentsFileSchema.safeParse(answered.value);
  if (!parsed.success || !isRawDownloadUrl(parsed.data.download_url)) {
    return { ok: false, error: buildNotServableError() };
  }
  return { ok: true, value: parsed.data.download_url };
}

function readSniffBytes(declared: CommittedFileMediaType): number {
  if (declared === CommittedFileMediaTypes.SVG) {
    return SVG_SNIFF_BYTES;
  }
  if (isVideoMediaType(declared)) {
    return VIDEO_SNIFF_BYTES;
  }
  return RASTER_SNIFF_BYTES;
}

/** The served type from the file's first bytes; a later piece holds none and keeps the declared type. */
async function confirmServedType(
  body: ReadableStream<Uint8Array>,
  declared: CommittedFileMediaType,
  extent: ByteExtent | undefined,
): Promise<Result<AttachmentBytes, GitHubApiError>> {
  if (extent !== undefined && extent.first !== 0) {
    return { ok: true, value: { body, contentType: declared, extent } };
  }
  let peeked;
  try {
    peeked = await readStreamHead(body, readSniffBytes(declared));
  } catch {
    return { ok: false, error: buildTransportError(CONTEXT) };
  }
  const contentType = sniffCommittedMediaType(peeked.head, declared);
  if (contentType === undefined) {
    await peeked.body.cancel();
    return { ok: false, error: buildNotServableError() };
  }

  const bytes: Mutable<AttachmentBytes> = { body: peeked.body, contentType };
  if (extent !== undefined) {
    bytes.extent = extent;
  }
  return { ok: true, value: bytes };
}

/**
 * The bytes at a `download_url`, with no credential, served under the type
 * the bytes themselves carry. The address honours `Range`, which the raw
 * media type would not. A 404 keeps its status: the address may have
 * expired, and the caller asks for a fresh one.
 */
export async function fetchCommittedFileBytes(
  fetchImpl: typeof fetch,
  downloadUrl: string,
  declared: CommittedFileMediaType,
  request: UpstreamBytesRequest,
): Promise<Result<AttachmentBytes, GitHubApiError>> {
  const headers: Record<string, string> = {
    "accept-encoding": IDENTITY_CODING,
  };
  if (request.range !== undefined) {
    headers["range"] = request.range;
  }
  let response: Response;
  try {
    response = await fetchWithHeadersDeadline(fetchImpl, downloadUrl, {
      init: { method: "GET", redirect: "follow", headers },
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
  const body = response.body;
  const isServable = body !== null && !isUnreadablePiece(response);
  if (!isServable) {
    await body?.cancel();
    return { ok: false, error: buildNotServableError() };
  }
  return confirmServedType(body, declared, readByteExtent(response));
}
