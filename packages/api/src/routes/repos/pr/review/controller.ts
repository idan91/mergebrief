// Hono-free. Owns the create-review call AND the one automatic degradation
// retry: GitHub's create-review is atomic — one invalid comment 422s the
// whole review. An anchoring 422 folds every comment into the review body
// (nothing silently dropped); an unknown-commit 422 rides the Result for the
// handler's fail-closed 409. A 401'd POST created nothing, so the client's
// refreshed retry cannot double-post.
import {
  createPullRequestReview,
  createUserOctokit,
  ReviewValidationClass,
  type CreatePullRequestReviewInput,
  type CreateReviewError,
} from "github";
import type { Mutable } from "types";
import {
  foldCommentsIntoBody,
  toPrimitiveComments,
  type SubmitComment,
} from "./logic/submit-comments";
import { buildGitHubDeniedResult } from "../../../../shared-errors/failures";
import type { ReviewControllerDeps } from "./types";

interface SubmitReviewInput {
  readonly base: Omit<CreatePullRequestReviewInput, "body" | "comments">;
  readonly body: string | undefined;
  readonly comments: readonly SubmitComment[];
}

function isValidation(
  error: CreateReviewError,
  kind: ReviewValidationClass,
): boolean {
  return error.validation === kind;
}

export default {
  async submitReview(deps: ReviewControllerDeps, input: SubmitReviewInput) {
    const anchoredInput: Mutable<CreatePullRequestReviewInput> = {
      ...input.base,
    };
    if (input.body !== undefined) {
      anchoredInput.body = input.body;
    }
    if (input.comments.length > 0) {
      anchoredInput.comments = toPrimitiveComments(input.comments);
    }

    const create = (reviewInput: CreatePullRequestReviewInput) =>
      deps.github.run((token) =>
        createPullRequestReview(createUserOctokit(token), reviewInput),
      );

    let created = await create(anchoredInput);

    // Anchoring 422 → ONE automatic degradation retry: all comments folded
    // into the body, same commitId and event. Only when there were comments —
    // a comment-free 422 has nothing to degrade.
    let commentsDegraded = false;
    const commentsWereRejected =
      !created.ok &&
      !("kind" in created.error) &&
      isValidation(created.error, ReviewValidationClass.INVALID_COMMENTS) &&
      input.comments.length > 0;
    if (commentsWereRejected) {
      commentsDegraded = true;
      created = await create({
        ...input.base,
        body: foldCommentsIntoBody(input.body, input.comments),
      });
    }

    if (!created.ok) {
      return buildGitHubDeniedResult(created.error, "mutation");
    }
    return {
      ok: true,
      value: { reviewId: created.value.reviewId, commentsDegraded },
    } as const;
  },
};
