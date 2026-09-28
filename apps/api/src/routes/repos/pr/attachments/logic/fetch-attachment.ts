// Two fetchers. An asset's rendered URL needs no credential: a private one
// carries GitHub's own short-lived signature, a public one answers 302 to S3
// for anyone, so that fetch sends no Authorization header and a token never
// rides to S3. A branch file is a Contents API read and carries the viewer's
// token; node's fetch drops the header on the cross-origin redirect.
import { ATTACHMENT_BRANCH, AttachmentMediaTypes } from "contract";
import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type GitHubApiErrorCode,
} from "github";
import type { Result } from "types/utils";
import {
  CONTENTS_RAW_MEDIA_TYPE,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
} from "../consts";
import type { AttachmentBytes, ReadBranchAttachmentInput } from "../types";

const CONTEXT = "user attachment";
const JSON_MEDIA_TYPE = "application/json";

/**
 * Raster only. An SVG is a document: served inline on this origin its script
 * would run with the viewer's session, so it is refused like a non-image.
 */
const SERVED_MEDIA_TYPES: ReadonlySet<string> = new Set(
  Object.values(AttachmentMediaTypes),
);

const CODE_BY_STATUS: Readonly<Record<number, GitHubApiErrorCode>> = {
  401: GitHubApiErrorCodes.UNAUTHORIZED,
  403: GitHubApiErrorCodes.FORBIDDEN,
  404: GitHubApiErrorCodes.NOT_FOUND,
};

function readMediaType(response: Response): string {
  const header = response.headers.get("content-type") ?? "";
  const [mediaType = ""] = header.split(";");
  return mediaType.trim().toLowerCase();
}

function buildStatusError(status: number): GitHubApiError {
  const code = CODE_BY_STATUS[status] ?? GitHubApiErrorCodes.REQUEST_FAILED;
  return { code, status, message: `${CONTEXT}: GitHub answered ${status}` };
}

function buildTransportError(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: `${CONTEXT}: request failed before a response`,
  };
}

function buildNotAnImageError(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_FOUND,
    status: 404,
    message: `${CONTEXT}: not an image`,
  };
}

export async function fetchAttachmentBytes(
  fetchImpl: typeof fetch,
  sourceUrl: string,
): Promise<Result<AttachmentBytes, GitHubApiError>> {
  let response: Response;
  try {
    response = await fetchImpl(sourceUrl, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "image/*" },
    });
  } catch {
    return { ok: false, error: buildTransportError() };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: buildStatusError(response.status) };
  }

  const contentType = readMediaType(response);
  if (!SERVED_MEDIA_TYPES.has(contentType) || response.body === null) {
    await response.body?.cancel();
    return { ok: false, error: buildNotAnImageError() };
  }

  return { ok: true, value: { body: response.body, contentType } };
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
): Promise<Result<AttachmentBytes, GitHubApiError>> {
  let response: Response;
  try {
    response = await fetchImpl(buildContentsUrl(input), {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: CONTENTS_RAW_MEDIA_TYPE,
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": GITHUB_API_VERSION,
      },
    });
  } catch {
    return { ok: false, error: buildTransportError() };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: buildStatusError(response.status) };
  }
  if (readMediaType(response) === JSON_MEDIA_TYPE || response.body === null) {
    await response.body?.cancel();
    return { ok: false, error: buildNotAnImageError() };
  }

  return {
    ok: true,
    value: { body: response.body, contentType: input.file.mediaType },
  };
}
