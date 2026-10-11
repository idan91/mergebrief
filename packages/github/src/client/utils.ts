import type { Result } from "types/utils";
import { GitHubApiErrorCodes, type GitHubApiError } from "../errors";

export function isUnauthorized(
  result: Result<unknown, GitHubApiError>,
): boolean {
  return !result.ok && result.error.code === GitHubApiErrorCodes.UNAUTHORIZED;
}
