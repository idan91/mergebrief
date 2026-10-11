// Counts the pull request row reads by coordinates (`pullRequests.getByNumber`)
// a request makes, off the SQL the harness database receives.
import type { PgliteHarness } from "persistence/testing";
import { vi } from "vitest";

const LOOKUP_BY_NUMBER =
  /from "pull_request" where .*"pull_request"\."pr_number" = \$\d+\)? limit/;

export interface PullRequestLookups {
  count(): number;
}

export function spyPullRequestLookups(
  harness: PgliteHarness,
): PullRequestLookups {
  const query = vi.spyOn(harness.database, "query");
  return {
    count: () =>
      query.mock.calls.filter(([sql]) => LOOKUP_BY_NUMBER.test(sql)).length,
  };
}
