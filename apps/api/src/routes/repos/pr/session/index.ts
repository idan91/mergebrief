// The Review Session routes, the reviewer's private work on one Brief.
// Composition only: read and writes share the target resolution, the span
// contract and the freeze rule through the session seam.
//
// Three rules shape every write. Each NAMES its Brief, since resolving "the
// newest Brief" would redirect a stale tab into a session it has never seen.
// Each binds through the session controller, so whichever lands first creates
// the session and copies the carried work in one transaction. And a frozen
// session refuses every write with `pr-changed-since-read`.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthzEnv } from "../../../../access/types";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { createSessionHandlers } from "./handler";

export function sessionRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createSessionHandlers(deps);

  app.query(
    {
      id: ProductQueryIds.READ_REVIEW_SESSION,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.readSession,
  );
  app.action(
    {
      id: ProductActionIds.CREATE_DRAFT_COMMENT,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/comments",
    handlers.createDraftComment,
  );
  app.action(
    {
      id: ProductActionIds.UPDATE_DRAFT_COMMENT,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "patch",
    "/comments/:draftId",
    handlers.updateDraftComment,
  );
  app.action(
    {
      id: ProductActionIds.REANCHOR_DRAFT_COMMENT,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "put",
    "/comments/:draftId/anchor",
    handlers.reanchorDraftComment,
  );
  app.action(
    {
      id: ProductActionIds.DELETE_DRAFT_COMMENT,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "delete",
    "/comments/:draftId",
    handlers.deleteDraftComment,
  );
  app.action(
    {
      id: ProductActionIds.SET_CHUNK_READ,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "put",
    "/chunks/:chunkId/read",
    handlers.setChunkRead,
  );
  app.action(
    {
      id: ProductActionIds.RECLASSIFY_GROUP,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "put",
    "/groups/:groupId/classification",
    handlers.reclassifyGroup,
  );
  // The three risk operations. Three, not one carrying a mode: a reason, a
  // per-flag evidence claim and a bare undo are different payloads recording
  // different judgments. Each takes an ARRAY, bulk is one call, which is
  // the operation's shape and not batching.
  app.action(
    {
      id: ProductActionIds.DISMISS_RISK,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/risks/dismiss",
    handlers.dismissRisk,
  );
  app.action(
    {
      id: ProductActionIds.ADDRESS_RISK,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/risks/address",
    handlers.addressRisk,
  );
  app.action(
    {
      id: ProductActionIds.REOPEN_RISK,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/risks/reopen",
    handlers.reopenRisk,
  );
  app.action(
    {
      id: ProductActionIds.SET_REVIEW_OUTCOME,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "put",
    "/outcome",
    handlers.setReviewOutcome,
  );

  return app;
}
