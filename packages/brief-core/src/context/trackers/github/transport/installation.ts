import type { Result } from "types";
import { TicketUnreadReasons } from "../../../../types";
import type { ContextReadFailure } from "../../../types";
import type { GitHubTransport, IssueLocator, IssueRecord } from "./port";

/** What the worker binds: one job's issue fetch, its API errors already mapped to unread reasons. */
export interface InstallationIssueApi {
  fetchIssue(
    locator: IssueLocator,
    signal: AbortSignal,
  ): Promise<Result<IssueRecord, ContextReadFailure>>;
}

export interface InstallationBounds {
  /** When set, only this repo's issues are read; any other is not-found. */
  readonly onlyRepo?:
    | { readonly owner: string; readonly repo: string }
    | undefined;
}

/**
 * The worker's transport over one job's credential. A url-box job reads
 * with the viewer's token for an instance-wide brief, so it stays inside
 * the PR's own repo: a private tracker the viewer can see must not leak.
 */
export function createInstallationTransport(
  api: InstallationIssueApi,
  bounds: InstallationBounds = {},
): GitHubTransport {
  return {
    async readIssue(locator, signal) {
      const { onlyRepo } = bounds;
      const outside =
        onlyRepo !== undefined &&
        (locator.owner !== onlyRepo.owner || locator.repo !== onlyRepo.repo);
      if (outside) {
        return {
          ok: false,
          error: {
            reason: TicketUnreadReasons.NOT_FOUND,
            detail: "outside this pull request's repository",
          },
        };
      }
      return api.fetchIssue(locator, signal);
    },
  };
}
