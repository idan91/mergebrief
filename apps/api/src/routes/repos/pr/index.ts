// The per-PR subtree (`/:repoId/pulls/:prNumber`), composition only: the
// repos router's one gate already covers every request under the prefix.
import type { AuthzEnv } from "../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { commentWriteRoutes } from "./comments";
import {
  conversationRoute,
  type ConversationRouteDeps,
  type ConversationRoutes,
} from "./conversation";
import { archivePullRoutes } from "./archive";
import { attachmentsRoute } from "./attachments";
import type { AttachmentsRouteDeps } from "./attachments/types";
import { deletePullRoute } from "./delete";
import { readsRoutes } from "./reads";
import { markReadyRoute } from "./ready";
import { reviewSubmitRoute } from "./review";
import { sessionRoutes } from "./session";

export function prRoutes(
  deps: ConversationRouteDeps & AttachmentsRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();

  // Conversation built first: it owns the conversation cache, and the write
  // routes evict a PR's entry on their success paths.
  const conversation = conversationRoute(deps);
  const evictConversation: ConversationRoutes["evictConversation"] = (
    ctx,
    repoId,
    prNumber,
  ) => conversation.evictConversation(ctx, repoId, prNumber);
  // Rooted, not prefixed: the reads leaf's paths share no common prefix.
  app.route("/", readsRoutes(deps));
  app.route("/", deletePullRoute(deps));
  app.route("/archive", archivePullRoutes(deps));
  app.route("/session", sessionRoutes(deps));
  app.route("/review", reviewSubmitRoute(deps, evictConversation));
  app.route("/ready", markReadyRoute(deps));
  app.route("/attachments", attachmentsRoute(deps));
  app.route("/comments", commentWriteRoutes(deps, evictConversation));
  app.route("/conversation", conversation.router);
  return app;
}
