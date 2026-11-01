// A committed file in the gated repository, read the way GitHub serves it to
// the viewer: the refs and the Contents API JSON on the viewer's token, then
// the `download_url` that JSON names, fetched with no credential. The raw
// media type would carry no `Range` support, so the bytes come from there.
import type { QualifiedRefNamespace } from "brief-core/media-address";
import { GitHubApiErrorCodes, type GitHubApiError } from "github";
import type { Result } from "types";
import { z } from "zod/v4";
import {
  CONTENTS_JSON_MEDIA_TYPE,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  RASTER_SNIFF_BYTES,
  RAW_DOWNLOAD_HOST,
  SVG_SNIFF_BYTES,
} from "../consts";
import {
  CommittedFileMediaTypes,
  type AttachmentBytes,
  type CommittedFileMediaType,
  type CommittedFileRequest,
  type CommittedRefQuery,
} from "../types";
import { sniffCommittedMediaType } from "./committed-media-type";
import { readStreamHead } from "./peek-stream";
import { buildStatusError, buildTransportError } from "./upstream-response";

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

async function requestGitHubJson(
  fetchImpl: typeof fetch,
  token: string,
  url: URL,
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
 * calls at once.
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
): Promise<Result<string, GitHubApiError>> {
  const repositoryPath = buildRepositoryPath(file.owner, file.repo);
  const filePath = file.fileSegments.map(encodeURIComponent).join("/");
  const url = new URL(
    `${repositoryPath}/contents/${filePath}`,
    GITHUB_API_ORIGIN,
  );
  url.searchParams.set("ref", file.ref);
  const answered = await requestGitHubJson(fetchImpl, token, url);
  if (!answered.ok) {
    return answered;
  }

  const parsed = contentsFileSchema.safeParse(answered.value);
  if (!parsed.success || !isRawDownloadUrl(parsed.data.download_url)) {
    return { ok: false, error: buildNotServableError() };
  }
  return { ok: true, value: parsed.data.download_url };
}

/**
 * The bytes at a `download_url`, with no credential, served under the type
 * the bytes themselves carry. A 404 keeps its status: the address may have
 * expired, and the caller asks for a fresh one.
 */
export async function fetchCommittedFileBytes(
  fetchImpl: typeof fetch,
  downloadUrl: string,
  declared: CommittedFileMediaType,
): Promise<Result<AttachmentBytes, GitHubApiError>> {
  let response: Response;
  try {
    response = await fetchImpl(downloadUrl, {
      method: "GET",
      redirect: "follow",
    });
  } catch {
    return { ok: false, error: buildTransportError(CONTEXT) };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: buildStatusError(CONTEXT, response.status) };
  }
  if (response.body === null) {
    return { ok: false, error: buildNotServableError() };
  }

  const sniffBytes =
    declared === CommittedFileMediaTypes.SVG
      ? SVG_SNIFF_BYTES
      : RASTER_SNIFF_BYTES;
  let peeked;
  try {
    peeked = await readStreamHead(response.body, sniffBytes);
  } catch {
    return { ok: false, error: buildTransportError(CONTEXT) };
  }
  const contentType = sniffCommittedMediaType(peeked.head, declared);
  if (contentType === undefined) {
    await peeked.body.cancel();
    return { ok: false, error: buildNotServableError() };
  }
  return { ok: true, value: { body: peeked.body, contentType } };
}
