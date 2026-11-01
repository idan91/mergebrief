// Two fetchers. An asset's rendered URL needs no credential: a private one
// carries GitHub's own short-lived signature, a public one answers 302 to S3
// for anyone, so that fetch sends no Authorization header and a token never
// rides to S3. A branch file is a Contents API read and carries the viewer's
// token; node's fetch drops the header on the cross-origin redirect.
import { ATTACHMENT_BRANCH, AttachmentMediaTypes } from "contract";
import type {
  GitHubApiError,
  GitHubCallFailure,
  ReviewerCredential,
} from "github";
import type { Result } from "types";
import {
  CONTENTS_RAW_MEDIA_TYPE,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
} from "../consts";
import type { AttachmentBytes, ReadBranchAttachmentInput } from "../types";
import {
  buildNotAnImageError,
  buildStatusError,
  buildTransportError,
  readMediaType,
} from "./upstream-response";
import { callWithViewerToken } from "./viewer-token";

const CONTEXT = "user attachment";
const JSON_MEDIA_TYPE = "application/json";

/** Raster only: a pasted asset is never served as an SVG document. */
const SERVED_MEDIA_TYPES: ReadonlySet<string> = new Set(
  Object.values(AttachmentMediaTypes),
);

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
    return { ok: false, error: buildTransportError(CONTEXT) };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: buildStatusError(CONTEXT, response.status) };
  }

  const contentType = readMediaType(response);
  if (!SERVED_MEDIA_TYPES.has(contentType) || response.body === null) {
    await response.body?.cancel();
    return { ok: false, error: buildNotAnImageError(CONTEXT) };
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
): Promise<Result<AttachmentBytes, GitHubCallFailure>> {
  return callWithViewerToken(credential, (token) =>
    fetchBranchAttachmentBytes(fetchImpl, token, input),
  );
}
