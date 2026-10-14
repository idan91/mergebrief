import type { Result } from "types/utils";
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

/** GitHub owner and repo names ignore letter case. */
function isSameRepository(
  left: Pick<IssueLocator, "owner" | "repo">,
  right: Pick<IssueLocator, "owner" | "repo">,
): boolean {
  const sameOwner = left.owner.toLowerCase() === right.owner.toLowerCase();
  const sameName = left.repo.toLowerCase() === right.repo.toLowerCase();
  const sameRepository = sameOwner && sameName;
  return sameRepository;
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
        onlyRepo !== undefined && !isSameRepository(locator, onlyRepo);
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
