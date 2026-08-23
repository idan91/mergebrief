// The /comments write family behind the pr subtree's shared gate. All
// writes run with the VIEWER's token (authorship stays the reviewer's) and
// are NOT gated on viewerIsAuthor or draft: GitHub separately authorizes
// each write. Every one IS a conversation write, so success calls the
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
  return app;
}
