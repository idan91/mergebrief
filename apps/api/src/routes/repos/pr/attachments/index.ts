// GET .../attachments/:assetId and POST .../attachments, behind the pr
// subtree's shared gate. A pasted screenshot in a GitHub comment is private
// to the repo, and the browser cannot carry a GitHub login across origins,
// so the API streams the bytes same-origin, where the session cookie rides
// an <img> request: a bare id is a GitHub asset, found through the URL
// GitHub rendered for it; `<id>.<ext>` is a file on the repo's attachments
// branch, read from the Contents API. The upload commits an image to that
// branch with the App's token and answers the URL a comment carries.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "../../../../product-operations/types";
import type { AuthzEnv } from "../../../authz";
import { createTtlCache } from "../../../ttl-cache";
import { SOURCES_CACHE_MAX_ENTRIES } from "./consts";
import { createAttachmentsHandlers } from "./handler";
import type {
  AttachmentsControllerDeps,
  AttachmentsRouteDeps,
  RenderedSources,
} from "./types";

export function attachmentsRoute(
  deps: AttachmentsRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const sourcesCache = createTtlCache<RenderedSources>(
    SOURCES_CACHE_MAX_ENTRIES,
  );
  const sourcesInFlight: AttachmentsControllerDeps["sourcesInFlight"] =
    new Map();
  const handlers = createAttachmentsHandlers(
    deps,
    sourcesCache,
    sourcesInFlight,
  );
  app.query(
    {
      id: ProductQueryIds.READ_ATTACHMENT,
      classification: WriteClassifications.READ,
    },
    "/:assetId",
    handlers.readAttachment,
  );
  app.action(
    {
      id: ProductActionIds.UPLOAD_ATTACHMENT,
      classification: WriteClassifications.EXTERNAL_WRITE,
    },
    "post",
    "/",
    handlers.uploadAttachment,
  );
  return app;
}
