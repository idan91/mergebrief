// POST /api/repos/:repoId/pulls/:prNumber/review submits ONE grouped formal
// review with the VIEWER's token, carrying the drafts the session holds and
// pinned to the head of the Brief the request names. Deliberately NOT here:
// the checkpoint write. The `pull_request_review` webhook, including the
// echo of this very submit, is the ONLY checkpoint writer.
import { ProductActionIds, type SubmitReviewResponse } from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import type { PullRequestEnv } from "../../../../access/types";
import { stampAuditTarget } from "../../../../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { BadRequest } from "../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { commitShaSchema } from "../../../wire-bounds";
import { resolveSessionWrite } from "../session/logic/write-seam";
import { throwSubmitFailure } from "./logic/wire-failures";
import { submitBodySchema } from "./schemas";
import { submitReview } from "./submit-review";
import type { EvictConversation } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

function createSubmitReviewHandler(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): Handler<PullRequestEnv> {
  return async (c) => {
    const json: unknown = await c.req.json().catch(() => undefined);
    const parsed = submitBodySchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequest();
    }
    const session = await resolveSessionWrite(deps, c);
    const commitId = commitShaSchema.safeParse(session.head);
    if (!commitId.success) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const submitted = await submitReview(c.get("logger"), access, {
      session,
      outcome: parsed.data.outcome,
      body: parsed.data.body,
      commitId: commitId.data,
    });
    if (!submitted.ok) {
      throwSubmitFailure(submitted.error, access.footing);
    }

    // The review is live on GitHub: nothing past this line may reach the
    // error path, which would invite a retry that posts it twice.
    stampAuditTarget(c, "pull_request", access.row.id);
    evictConversation(access.rowScope, access.repoId, access.prNumber);
    const { reviewId, commentsFolded, commentsTotal } = submitted.value;
    // `commentsDegraded` stays one release for the CLI receipt; the counts
    // are what the web copy reads.
    const body: SubmitReviewResponse = {
      reviewId: Number(reviewId),
      commentsDegraded: commentsFolded > 0,
      commentsFolded,
      commentsTotal,
    };
    return c.json(body, HttpStatuses.CREATED, NO_STORE);
  };
}

export function reviewSubmitRoute(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.action(
    {
      id: ProductActionIds.SUBMIT_REVIEW,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/",
    createSubmitReviewHandler(deps, evictConversation),
  );
  return app;
}
