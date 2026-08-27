// POST /api/repos/:repoId/pulls/:prNumber/ready — behind the pr subtree's
// shared gate; runs the GraphQL `markPullRequestReadyForReview` mutation
// with the VIEWER's token (GitHub itself enforces that only the
// author/maintainer may mark ready, so no viewerIsAuthor check here). On
// success OUR `draft` mirror flips to false in the same request; the later
// `ready_for_review` webhook lands as an idempotent no-op. The poll/webhook
// is the reconciler for every race in between.
import { ProductActionIds } from "../../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../../product-operations/types";
import type { AuthRouteDeps } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import createReadyHandlers from "./handler";

export function markReadyRoute(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createReadyHandlers(deps);
  app.action(
    {
      id: ProductActionIds.MARK_READY,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/",
    handlers.markReady,
  );
  return app;
}
