import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type GitHubApiErrorCode,
} from "github";
import { HttpStatuses } from "types";
import { IDENTITY_CODING } from "../consts";
import type { ByteExtent } from "../types";
import { parseContentRange } from "./byte-range";

const LENGTH_PATTERN = /^\d{1,15}$/;

const CODE_BY_STATUS: Readonly<Record<number, GitHubApiErrorCode>> = {
  [HttpStatuses.UNAUTHORIZED]: GitHubApiErrorCodes.UNAUTHORIZED,
  [HttpStatuses.FORBIDDEN]: GitHubApiErrorCodes.FORBIDDEN,
  [HttpStatuses.NOT_FOUND]: GitHubApiErrorCodes.NOT_FOUND,
};

/** The response's media type, parameters dropped and lower-cased. */
export function readMediaType(response: Response): string {
  const header = response.headers.get("content-type") ?? "";
  const [mediaType = ""] = header.split(";");
  return mediaType.trim().toLowerCase();
}

export function buildStatusError(
  context: string,
  status: number,
): GitHubApiError {
  const code = CODE_BY_STATUS[status] ?? GitHubApiErrorCodes.REQUEST_FAILED;
  return { code, status, message: `${context}: GitHub answered ${status}` };
}

export function buildTransportError(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: `${context}: request failed before a response`,
  };
}

export function buildNotAnImageError(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_FOUND,
    status: HttpStatuses.NOT_FOUND,
    message: `${context}: not an image`,
  };
}

/** The whole file a 200 carries, judged by its length; a length fetch decoded is no size. */
function readWholeExtent(response: Response): ByteExtent | undefined {
  const coding = response.headers.get("content-encoding") ?? IDENTITY_CODING;
  const length = response.headers.get("content-length") ?? "";
  const normalizedCoding = coding.trim().toLowerCase();
  const isIdentity = normalizedCoding === IDENTITY_CODING;
  const isPlainLength = isIdentity && LENGTH_PATTERN.test(length);
  const total = Number(length);
  if (!isPlainLength || total === 0) {
    return undefined;
  }
  return { first: 0, last: total - 1, total };
}

/** Which bytes of the file an upstream answer holds: its `Content-Range`, or its whole length. */
export function readByteExtent(response: Response): ByteExtent | undefined {
  if (response.status === HttpStatuses.PARTIAL_CONTENT) {
    return parseContentRange(response.headers.get("content-range") ?? "");
  }
  return readWholeExtent(response);
}

/** A piece whose `Content-Range` cannot be read: no reply may serve its bytes as the whole file. */
export function isUnreadablePiece(response: Response): boolean {
  const isPiece = response.status === HttpStatuses.PARTIAL_CONTENT;
  const hasNoExtent = readByteExtent(response) === undefined;
  return isPiece && hasNoExtent;
}
