// The per-PR subtree (`/:repoId/pulls/:prNumber`) — composition plus the ONE
// per-repo gate. The wildcard `use` is METHOD-AGNOSTIC and covers the whole
// subtree, unmatched methods/paths included, so every request under the
// prefix traverses exactly one gate and an unauthorized probe meets the same
// hint-free 404 posture everywhere.
import { createAuthzMiddleware, type AuthzEnv } from "../../authz";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { commentWriteRoutes } from "./comments";
import {
  conversationRoutes,
  type ConversationRouteDeps,
  type ConversationRoutes,
} from "./conversation";
import { readsRoute } from "./reads";
import { markReadyRoute } from "./ready";
import { reviewSubmitRoute } from "./review";
import { sessionRoutes } from "./session";

export function prRoutes(deps: ConversationRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);
  app.use("*", authz);

  // Conversation built first: it owns the conversation cache, and the write
  // routes evict a PR's entry on their success paths.
  const conversation = conversationRoutes(deps);
  const evictConversation: ConversationRoutes["evictConversation"] = (
    installationId,
    repoId,
    prNumber,
  ) => conversation.evictConversation(installationId, repoId, prNumber);
  // Rooted, not prefixed: the reads leaf's paths share no common prefix.
  app.route("/", readsRoute(deps));
  app.route("/session", sessionRoutes(deps));
  app.route("/review", reviewSubmitRoute(deps, evictConversation));
  app.route("/ready", markReadyRoute(deps));
  app.route("/comments", commentWriteRoutes(deps, evictConversation));
  app.route("/conversation", conversation.router);
  return app;
}
