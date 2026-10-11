// POST /api/repos/:repoId/pulls/:prNumber/review, the review-submit route,
// behind the pr subtree's shared gate. Posts ONE grouped formal review with
// the VIEWER's token, carrying the drafts the SESSION holds and pinned to
// the head of the Brief the request names. The request carries no comments:
// they were saved as they were written. Deliberately NOT here: the
// checkpoint write, the `pull_request_review` webhook (including the echo
// of this very submit) is the ONLY checkpoint writer.
import { ProductActionIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { PullRequestEnv } from "../../../../access/types";
import { createReviewHandlers } from "./handler";
import type { EvictConversation } from "./types";

export function reviewSubmitRoute(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  const handlers = createReviewHandlers(deps, evictConversation);
  app.action(
    {
      id: ProductActionIds.SUBMIT_REVIEW,
      classification: WriteClassifications.EXTERNAL_WRITE,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "post",
    "/",
    handlers.submitReview,
  );
  return app;
}
