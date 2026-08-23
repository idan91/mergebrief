// The /comments write family behind the pr subtree's shared gate:
//   POST /                                  — publish one held draft comment
//   POST /:commentId/replies                — reply to a review comment
//   POST /:commentId/{resolve,unresolve}    — flip a thread's state
// All run with the VIEWER's token (authorship stays the reviewer's), NOT
// gated on viewerIsAuthor or draft: GitHub separately authorizes each
// write. Every one IS a conversation write — success calls the injected
// `evictConversation` hook.
import { PRODUCT_ACTION_ID } from "../../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../../product-operations/types";
import type { AuthRouteDeps } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import createCommentsHandlers from "./handler";
import type { EvictConversation } from "./types";

export function commentWriteRoutes(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createCommentsHandlers(deps, evictConversation);
  app.action(
    {
      id: PRODUCT_ACTION_ID.CREATE_INLINE_COMMENT,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/",
    handlers.publishInlineComment,
  );
  app.action(
    {
      id: PRODUCT_ACTION_ID.REPLY_TO_COMMENT,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/:commentId/replies",
    handlers.replyToComment,
  );
  app.action(
    {
      id: PRODUCT_ACTION_ID.RESOLVE_THREAD,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/:commentId/resolve",
    handlers.resolveThread,
  );
  app.action(
    {
      id: PRODUCT_ACTION_ID.UNRESOLVE_THREAD,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/:commentId/unresolve",
    handlers.unresolveThread,
  );
  return app;
}
