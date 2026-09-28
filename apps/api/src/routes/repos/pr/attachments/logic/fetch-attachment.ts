// The rendered URL needs no credential: a private one carries GitHub's own
// short-lived signature, a public one answers 302 to S3 for anyone. Sending
// no Authorization header is the point, so a token never rides to S3.
import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type GitHubApiErrorCode,
} from "github";
import type { Result } from "types/utils";
import type { AttachmentBytes } from "../types";

const CONTEXT = "user attachment";

/**
 * Raster only. An SVG is a document: served inline on this origin its script
 * would run with the viewer's session, so it is refused like a non-image.
 */
const SERVED_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

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
