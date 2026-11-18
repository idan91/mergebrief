import type { ResponseHeaders } from "@octokit/types";

const FILE_HEADER_PATTERN = /^diff --git /gm;

const IDENTITY_ENCODING = "identity";

export function countDiffFiles(diff: string): number {
  return diff.match(FILE_HEADER_PATTERN)?.length ?? 0;
}

/**
 * undici decodes gzip but keeps the compressed `content-length`, so only an
 * identity reply's length is comparable. A non-UTF-8 byte re-encodes longer,
 * never shorter, so a short count is truncation.
 */
export function isShortOfDeclaredLength(
  diff: string,
  headers: ResponseHeaders,
): boolean {
  const encoding = headers["content-encoding"];
  const declared = Number(headers["content-length"]);
  const isComparable =
    (encoding === undefined || encoding === IDENTITY_ENCODING) &&
    Number.isSafeInteger(declared);
  if (!isComparable) {
    return false;
  }
  return Buffer.byteLength(diff, "utf8") < declared;
}
