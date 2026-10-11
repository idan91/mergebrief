// The /comments write family behind the pr subtree's shared gate:
//   POST /, publish one held draft comment
//   POST /:commentId/replies, reply to a review comment
//   POST /:commentId/{resolve,unresolve}, flip a thread's state
// All run with the VIEWER's token (authorship stays the reviewer's), NOT
// gated on viewerIsAuthor or draft: GitHub separately authorizes each
// write. Every one IS a conversation write, success calls the injected
// `evictConversation` hook.
import { ProductActionIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../../access/types";
import { createCommentsHandlers } from "./handler";
import type { EvictConversation } from "./types";

export function commentWriteRoutes(
  deps: AuthRouteDeps,
  evictConversation: EvictConversation,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createCommentsHandlers(deps, evictConversation);
  app.action(
    {
      id: ProductActionIds.CREATE_INLINE_COMMENT,
      classification: WriteClassifications.EXTERNAL_WRITE,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "post",
    "/",
    handlers.publishInlineComment,
  );
  app.action(
    {
      id: ProductActionIds.REPLY_TO_COMMENT,
      classification: WriteClassifications.EXTERNAL_WRITE,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "post",
    "/:commentId/replies",
    handlers.replyToComment,
  );
  app.action(
    {
      id: ProductActionIds.RESOLVE_THREAD,
      classification: WriteClassifications.EXTERNAL_WRITE,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "post",
    "/:commentId/resolve",
    handlers.resolveThread,
  );
  app.action(
    {
      id: ProductActionIds.UNRESOLVE_THREAD,
      classification: WriteClassifications.EXTERNAL_WRITE,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "post",
    "/:commentId/unresolve",
    handlers.unresolveThread,
  );
  return app;
}
