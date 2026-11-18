import type { RepoName } from "generators/trackers";
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
  /**
   * Whether `repo` is at least as widely visible as `pullRequestRepo`. A
   * brief is read by all of the pull request's readers, and repository
   * visibility stands in for who they are: no API lists a repository's
   * readers, so two private repositories count as one audience.
   */
  isVisibleToReadersOf(
    repo: RepoName,
    pullRequestRepo: RepoName,
    signal: AbortSignal,
  ): Promise<Result<boolean, ContextReadFailure>>;
}

export interface InstallationBounds {
  /** The pull request's own repository, whose readers read the brief. */
  readonly pullRequestRepo: RepoName;
  /** When set, only these repos' issues are read; any other is not-found. */
  readonly onlyRepos?: readonly RepoName[] | undefined;
}

/** GitHub owner and repo names ignore letter case. */
function isSameRepository(left: RepoName, right: RepoName): boolean {
  const sameOwner = left.owner.toLowerCase() === right.owner.toLowerCase();
  const sameName = left.repo.toLowerCase() === right.repo.toLowerCase();
  const sameRepository = sameOwner && sameName;
  return sameRepository;
}

const OUTSIDE_BOUND_REPOS: ContextReadFailure = {
  reason: TicketUnreadReasons.NOT_FOUND,
  detail: "outside the repositories this pull request reads",
};

const LESS_VISIBLE_REPOSITORY: ContextReadFailure = {
  reason: TicketUnreadReasons.NOT_FOUND,
  detail:
    "the issue's repository is less widely visible than the pull request's",
};

/** An answer that cannot be had refuses the read: an unread ticket costs less than a leaked one. */
async function checkCrossRepositoryRead(
  api: InstallationIssueApi,
  pullRequestRepo: RepoName,
  locator: IssueLocator,
  signal: AbortSignal,
): Promise<Result<undefined, ContextReadFailure>> {
  if (isSameRepository(locator, pullRequestRepo)) {
    return { ok: true, value: undefined };
  }

  const visible = await api.isVisibleToReadersOf(
    locator,
    pullRequestRepo,
    signal,
  );
  if (!visible.ok) {
    return visible;
  }
  if (!visible.value) {
    return { ok: false, error: LESS_VISIBLE_REPOSITORY };
  }
  return { ok: true, value: undefined };
}

/**
 * The worker's transport over one job's credential. A url-box job reads
 * with the viewer's token for an instance-wide brief, so it stays inside
 * the PR's own repo: a private tracker the viewer can see must not leak. An
 * installation job stays inside the PR's repo and its `issuesRepo` unless
 * the instance allows sibling repos, and either way reads no issue from a
 * repository less widely visible than the pull request's.
 */
export function createInstallationTransport(
  api: InstallationIssueApi,
  bounds: InstallationBounds,
): GitHubTransport {
  return {
    async readIssue(locator, signal) {
      const { onlyRepos, pullRequestRepo } = bounds;
      const outside =
        onlyRepos !== undefined &&
        !onlyRepos.some((repo) => isSameRepository(locator, repo));
      if (outside) {
        return { ok: false, error: OUTSIDE_BOUND_REPOS };
      }

      const crossRepository = await checkCrossRepositoryRead(
        api,
        pullRequestRepo,
        locator,
        signal,
      );
      if (!crossRepository.ok) {
        return crossRepository;
      }
      return api.fetchIssue(locator, signal);
    },
  };
}
