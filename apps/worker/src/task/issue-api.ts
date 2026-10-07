// One job's issue fetch for the installation transport: the same bound
// source the rest of the job uses, so the installation (or viewer)
// credential decides what it can see.
import { TicketUnreadReasons, type InstallationIssueApi } from "brief-core";
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

/** The job's source as the installation transport's issue API; API errors become unread reasons. */
export function createInstallationIssueApi(
  source: PullRequestSource,
): InstallationIssueApi {
  return {
    async fetchIssue(locator) {
      const read = await source.fetchIssue(
        locator.owner,
        locator.repo,
        locator.number,
      );
      if (read.ok) {
        return read;
      }
      return { ok: false, error: toReadFailure(read.error) };
    },
  };
}
