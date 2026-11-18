import {
  resolveMentionTargets,
  searchMentionableTeams,
  searchMentionableUsers,
} from "../operations/mentions";
import type { RepositoryRef } from "../operations/pull-request/types";
import type { ReviewerRepoClient, ReviewerRunners } from "./types";

type ReviewerMentionReads = Pick<
  ReviewerRepoClient,
  "searchMentionableUsers" | "searchMentionableTeams" | "resolveMentionTargets"
>;

/** On the reviewer's token only, so nobody GitHub hides from them is shown. */
export function buildReviewerMentionReads(
  repo: RepositoryRef,
  { own }: ReviewerRunners,
): ReviewerMentionReads {
  return {
    searchMentionableUsers(query) {
      return own(
        (octokit) => searchMentionableUsers(octokit, { ...repo, query }),
        "search mentionable users",
      );
    },
    searchMentionableTeams(query) {
      return own(
        (octokit) =>
          searchMentionableTeams(octokit, { org: repo.owner, query }),
        "search mentionable teams",
      );
    },
    resolveMentionTargets(targets) {
      return own(
        (octokit) => resolveMentionTargets(octokit, { targets }),
        "resolve mention targets",
      );
    },
  };
}
