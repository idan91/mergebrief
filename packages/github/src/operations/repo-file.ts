// Repo-file fetch for the `.mergebrief/` config surface: read ONE file's
// content via the contents API. Default-branch resolution is delegated to
// GitHub — omitting `ref` serves the repository's default branch, avoiding a
// `repos.get` round-trip and its staleness window. The size guard rejects
// oversize blobs BEFORE decoding; the semantic byte budgets live in
// `repo-config`, not here.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result, ValueOf } from "../types";

export const RepoFileKinds = {
  FILE: "file",
  ABSENT: "absent",
  TOO_LARGE: "too-large",
} as const;
export type RepoFileKind = ValueOf<typeof RepoFileKinds>;

export interface RepoFileContent {
  readonly kind: typeof RepoFileKinds.FILE;
  /** UTF-8 decoded file content. */
  readonly content: string;
  /** Git blob SHA of the served content — the origin stamp. */
  readonly blobSha: string;
  /** Blob size in bytes, as reported by GitHub. */
  readonly size: number;
}

/** The path does not exist on the resolved ref — an outcome, not an error. */
export interface RepoFileAbsent {
  readonly kind: typeof RepoFileKinds.ABSENT;
}

/** The blob exceeds `maxBytes`; rejected before decode. */
export interface RepoFileTooLarge {
  readonly kind: typeof RepoFileKinds.TOO_LARGE;
  readonly blobSha: string;
  readonly size: number;
}

export type RepoFileResult =
  | RepoFileContent
  | RepoFileAbsent
  | RepoFileTooLarge;

export interface GetRepoFileInput {
  readonly owner: string;
  readonly repo: string;
  readonly path: string;
  /** Omit to read from the repository's default branch (GitHub API semantics). */
  readonly ref?: string;
  /** Size guard: blobs larger than this are rejected before decode. */
  readonly maxBytes: number;
}

// The contents API returns an ARRAY for a directory, otherwise an object whose
// `type` discriminates file/symlink/submodule. Only `type: "file"` with base64
// content is acceptable for a config-file read.
const contentsFileSchema = z.object({
  type: z.string(),
  size: z.number().int().nonnegative(),
  sha: z.string().min(1),
  content: z.string().optional(),
  encoding: z.string().optional(),
  // GitHub reports followed/unfollowable symlinks and submodules through
  // these markers even when `type` reads "file" — their presence disqualifies
  // the payload as a regular blob.
  target: z.string().optional(),
  submodule_git_url: z.string().optional(),
});

/** GitHub line-wraps base64; strip whitespace, then demand canonical base64. */
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode a contents-API base64 payload strictly: canonical alphabet/padding
 * only, and the result must be valid UTF-8 — replacing bytes with U+FFFD would
 * hand a corrupted file downstream as if it were the committed content.
 */
function decodeBase64Utf8(
  wrapped: string,
): { text: string; bytes: number } | undefined {
  const compact = wrapped.replace(/\s+/g, "");
  if (!BASE64_BODY.test(compact) || compact.length % 4 !== 0) {
    return undefined;
  }
  const buffer = Buffer.from(compact, "base64");
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      bytes: buffer.length,
    };
  } catch {
    return undefined;
  }
}

/**
 * Fetch one repo file's decoded content via the contents API. A 404 is the
 * `absent` outcome (expected — most repos carry no `.mergebrief/`); a blob
 * over `maxBytes` is `too-large` (rejected before decode); a non-file path
 * (directory/symlink/submodule) or non-base64 payload is a sanitized error.
 */
export async function getRepoFile(
  octokit: Octokit,
  input: GetRepoFileInput,
): Promise<Result<RepoFileResult, GitHubApiError>> {
  let body: unknown;
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: input.owner,
        repo: input.repo,
        path: input.path,
        ...(input.ref === undefined ? {} : { ref: input.ref }),
      },
    );
    body = response.data;
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      return { ok: true, value: { kind: RepoFileKinds.ABSENT } };
    }
    return { ok: false, error: mapRequestError(error, "fetch repo file") };
  }

  if (Array.isArray(body)) {
    // Directory listing — the path is not a file.
    return { ok: false, error: unexpectedResponseError("fetch repo file") };
  }
  const parsed = contentsFileSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.type !== "file" ||
    parsed.data.target !== undefined ||
    parsed.data.submodule_git_url !== undefined
  ) {
    return { ok: false, error: unexpectedResponseError("fetch repo file") };
  }
  const { size, sha, content, encoding } = parsed.data;
  if (size > input.maxBytes) {
    return {
      ok: true,
      value: { kind: RepoFileKinds.TOO_LARGE, blobSha: sha, size },
    };
  }
  if (encoding !== "base64" || content === undefined) {
    return { ok: false, error: unexpectedResponseError("fetch repo file") };
  }
  const decoded = decodeBase64Utf8(content);
  if (decoded === undefined) {
    // Malformed base64 or non-UTF-8 bytes: not a text config file.
    return { ok: false, error: unexpectedResponseError("fetch repo file") };
  }
  if (decoded.bytes > input.maxBytes) {
    // The reported `size` passed the guard but the actual payload is bigger —
    // the decoded byte count is the truth the cap protects.
    return {
      ok: true,
      value: {
        kind: RepoFileKinds.TOO_LARGE,
        blobSha: sha,
        size: decoded.bytes,
      },
    };
  }
  return {
    ok: true,
    value: {
      kind: RepoFileKinds.FILE,
      content: decoded.text,
      blobSha: sha,
      size: decoded.bytes,
    },
  };
}
