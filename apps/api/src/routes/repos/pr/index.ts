// The per-PR subtree (`/:repoId/pulls/:prNumber`), composition plus the ONE
// per-repo gate. The wildcard `use` is METHOD-AGNOSTIC and covers the whole
// subtree, unmatched methods/paths included, so every request under the
// prefix traverses exactly one gate and an unauthorized probe meets the same
// hint-free 404 posture everywhere.
import type { InstallationResolver } from "../../installation-resolver";
import { createAuthzMiddleware, type AuthzEnv } from "../../authz";
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
import { deletePullRoute } from "./delete";
import { readsRoutes } from "./reads";
import { markReadyRoute } from "./ready";
import { reviewSubmitRoute } from "./review";
import { sessionRoutes } from "./session";

export function prRoutes(
  deps: ConversationRouteDeps,
  installations: InstallationResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const authz = createAuthzMiddleware(deps, installations);
  app.use("*", authz);

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
  app.route("/comments", commentWriteRoutes(deps, evictConversation));
  app.route("/conversation", conversation.router);
  return app;
}
