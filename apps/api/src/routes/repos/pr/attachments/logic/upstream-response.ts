import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type GitHubApiErrorCode,
} from "github";
import { HttpStatuses } from "types";

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
