// The worker's IssueReader: the GitHub Issues provider reads the primary
// ticket through the same bound source the rest of the job uses, so the
// installation (or viewer) credential decides what it can see.
import { TicketUnreadReasons, type IssueReader } from "brief-core";
import { GitHubApiErrorCodes, type GitHubApiError } from "github";
import type { ContextReadFailure } from "brief-core";
import type { PullRequestSource } from "./github-port";

function toReadFailure(error: GitHubApiError): ContextReadFailure {
  const detail = error.message;
  switch (error.code) {
    case GitHubApiErrorCodes.NOT_FOUND: {
      return { reason: TicketUnreadReasons.NOT_FOUND, detail };
    }
    case GitHubApiErrorCodes.FORBIDDEN:
    case GitHubApiErrorCodes.UNAUTHORIZED: {
      return { reason: TicketUnreadReasons.NO_CREDENTIAL, detail };
    }
    case GitHubApiErrorCodes.RATE_LIMITED: {
      return { reason: TicketUnreadReasons.RATE_LIMITED, detail };
    }
    default: {
      return { reason: TicketUnreadReasons.TIMEOUT, detail };
    }
  }
}

export interface IssueReaderBounds {
  /** When set, only this repo's issues are read; any other is not-found. */
  readonly onlyRepo?:
    | { readonly owner: string; readonly repo: string }
    | undefined;
}

/**
 * Bind the provider port to one job's GitHub source. A url-box job reads
 * with the viewer's token for an instance-wide brief, so it stays inside
 * the PR's own repo: a private tracker the viewer can see must not leak.
 */
export function createIssueReader(
  source: PullRequestSource,
  bounds: IssueReaderBounds = {},
): IssueReader {
  return {
    async readIssue(locator) {
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
      const read = await source.fetchIssue(
        locator.owner,
        locator.repo,
        locator.number,
      );
      if (read.ok) return read;
      return { ok: false, error: toReadFailure(read.error) };
    },
  };
}
