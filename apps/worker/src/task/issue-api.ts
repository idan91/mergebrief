// One job's issue fetch for the installation transport: the same bound
// source the rest of the job uses, so the installation (or viewer)
// credential decides what it can see.
import {
  TicketUnreadReasons,
  type ContextReadFailure,
  type InstallationIssueApi,
} from "brief-core";
import type { RepoName } from "generators/trackers";
import {
  CredentialFailureCodes,
  GitHubApiErrorCodes,
  RepositoryVisibilities,
  type GitHubCallFailure,
  type RepositoryVisibility,
} from "github";
import type { Result } from "types/utils";
import type { PullRequestSource } from "./github-port";

function toReadFailure(error: GitHubCallFailure): ContextReadFailure {
  const detail = error.message;
  switch (error.code) {
    case GitHubApiErrorCodes.NOT_FOUND: {
      return { reason: TicketUnreadReasons.NOT_FOUND, detail };
    }
    case GitHubApiErrorCodes.FORBIDDEN:
    case GitHubApiErrorCodes.UNAUTHORIZED:
    case CredentialFailureCodes.CREDENTIAL_UNREADABLE: {
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

/** How widely a repository is read: a higher rank is read by everyone a lower one is. */
const AUDIENCE_RANKS: Record<RepositoryVisibility, number> = {
  [RepositoryVisibilities.PRIVATE]: 0,
  [RepositoryVisibilities.INTERNAL]: 1,
  [RepositoryVisibilities.PUBLIC]: 2,
};

async function readVisibility(
  source: PullRequestSource,
  repo: RepoName,
): Promise<Result<RepositoryVisibility, ContextReadFailure>> {
  const read = await source.fetchRepositoryVisibility(repo.owner, repo.repo);
  if (read.ok) {
    return read;
  }
  return { ok: false, error: toReadFailure(read.error) };
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
    async isVisibleToReadersOf(repo, pullRequestRepo) {
      const issueSide = await readVisibility(source, repo);
      if (!issueSide.ok) {
        return issueSide;
      }
      if (issueSide.value === RepositoryVisibilities.PUBLIC) {
        return { ok: true, value: true };
      }

      const pullRequestSide = await readVisibility(source, pullRequestRepo);
      if (!pullRequestSide.ok) {
        return pullRequestSide;
      }
      const issueRank = AUDIENCE_RANKS[issueSide.value];
      const visible = issueRank >= AUDIENCE_RANKS[pullRequestSide.value];
      return { ok: true, value: visible };
    },
  };
}
