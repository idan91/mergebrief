// Hono-free. One reviewer channel per request: the refresh budget spans the
// fresh repo re-resolve AND the write; failures ride the Result whole.
import {
  createInlineReviewComment,
  createReviewCommentReply,
  createUserOctokit,
  fetchRepositoryById,
  setReviewThreadResolution,
} from "github";
import { buildGitHubDeniedResult } from "../../../../shared-errors/failures";
import type { RepoId } from "persistence";
import type { Result } from "types";
import { ApiErrorCode } from "../../../../error-response";
import { NotFound } from "../../../../shared-errors/api-error";
import { splitRepoSlug } from "../../utils";
import type {
  CommentsControllerDeps,
  RepoResolveFailure,
  RepoTarget,
} from "./types";

type ResolveTargetResult = Result<RepoTarget, RepoResolveFailure>;

export default {
  /**
   * Resolve the target `owner/name` FRESH by numeric repo id, right before a
   * mutating write (gated-route rule): the gate's cached slug may be up to
   * 60s stale, and a rename + name-reuse inside that window would point the
   * write at the wrong repository.
   */
  async resolveFreshRepoTarget(deps: CommentsControllerDeps, repoId: RepoId) {
    const repoInfo = await deps.github.run((token) =>
      fetchRepositoryById(createUserOctokit(token), repoId),
    );
    if (!repoInfo.ok) {
      return buildGitHubDeniedResult(repoInfo.error, "resolve");
    }
    const target = splitRepoSlug(repoInfo.value.fullName);
    if (target === undefined) {
      throw new NotFound(ApiErrorCode.NOT_FOUND);
    }
    return { ok: true, value: target } satisfies ResolveTargetResult;
  },

  /** POST one held draft as an inline review comment. A 401'd POST created
   * nothing, so the client's refreshed retry cannot double-post. */
  async postInlineComment(
    deps: CommentsControllerDeps,
    input: Parameters<typeof createInlineReviewComment>[1],
  ) {
    const posted = await deps.github.run((token) =>
      createInlineReviewComment(createUserOctokit(token), input),
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
      createReviewCommentReply(createUserOctokit(token), input),
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
      setReviewThreadResolution(createUserOctokit(token), input),
    );
    if (!outcome.ok) {
      return buildGitHubDeniedResult(outcome.error, "mutation");
    }
    return outcome;
  },
};
