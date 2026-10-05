// Hono-free. The mutation is idempotent (converged states), so the client's
// one refreshed retry after a 401'd GraphQL call is safe: it performed no
// write. Failures ride the Result whole with their phase.
import { markPullRequestReadyForReview } from "github";
import { buildGitHubDeniedResult } from "../../../../shared-errors/failures";
import type { ReadyControllerDeps } from "./types";

export default {
  async markPullRequestReady(
    deps: ReadyControllerDeps,
    input: Parameters<typeof markPullRequestReadyForReview>[1],
  ) {
    const marked = await deps.github.run((token) => {
      const octokit = deps.github.createOctokit(token);
      return markPullRequestReadyForReview(octokit, input);
    });
    if (!marked.ok) {
      return buildGitHubDeniedResult(marked.error, "mutation");
    }
    return marked;
  },
};
