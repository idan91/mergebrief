// Counts the pull request row reads by coordinates (`pullRequests.getByNumber`)
// a request makes, off the SQL the harness database receives.
import { vi } from "vitest";
import type { SharedPglite } from "./shared-pglite";

const LOOKUP_BY_NUMBER =
  /from "pull_request" where .*"pull_request"\."pr_number" = \$\d+\)? limit/;

export interface PullRequestLookups {
  count(): number;
}

export function spyPullRequestLookups(
  harness: SharedPglite,
): PullRequestLookups {
  const query = vi.spyOn(harness.database, "query");
  return {
    count: () =>
      query.mock.calls.filter(([sql]) => LOOKUP_BY_NUMBER.test(sql)).length,
  };
}
