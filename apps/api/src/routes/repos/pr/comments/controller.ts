// Hono-free. One reviewer channel per request: the refresh budget spans the
// fresh repo re-resolve AND the write; failures ride the Result whole.
import {
  createInlineReviewComment,
  createReviewCommentReply,
  setReviewThreadResolution,
} from "github";
import { buildGitHubDeniedResult } from "../../../../shared-errors/failures";
import type { CommentsControllerDeps } from "./types";

export default {
  /** POST one held draft as an inline review comment. A 401'd POST created
   * nothing, so the client's refreshed re-run cannot double-post. */
  async postInlineComment(
    deps: CommentsControllerDeps,
    input: Parameters<typeof createInlineReviewComment>[1],
  ) {
    const posted = await deps.github.run((token) =>
      createInlineReviewComment(
        deps.github.createMutationOctokit(token),
        input,
      ),
    );
    if (!posted.ok) {
      return buildGitHubDeniedResult(posted.error, "mutation");
    }
    return posted;
  },

  /** POST a reply under an existing review comment. */
  async postReply(
    deps: CommentsControllerDeps,
    input: Parameters<typeof createReviewCommentReply>[1],
  ) {
    const created = await deps.github.run((token) =>
      createReviewCommentReply(deps.github.createMutationOctokit(token), input),
    );
    if (!created.ok) {
      return buildGitHubDeniedResult(created.error, "mutation");
    }
    return created;
  },

  /** Flip a thread's resolution state. A 401'd walk/mutation performed no
   * write we care about re-running; the op is idempotent regardless
   * (converged states), so the client's one refreshed retry is safe. */
  async setThreadResolution(
    deps: CommentsControllerDeps,
    input: Parameters<typeof setReviewThreadResolution>[1],
  ) {
    const outcome = await deps.github.run((token) =>
      setReviewThreadResolution(deps.github.createOctokit(token), input),
    );
    if (!outcome.ok) {
      return buildGitHubDeniedResult(outcome.error, "mutation");
    }
    return outcome;
  },
};
