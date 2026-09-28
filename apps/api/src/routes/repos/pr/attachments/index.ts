// GET /api/repos/:repoId/pulls/:prNumber/attachments/:assetId, behind the
// pr subtree's shared gate. A pasted screenshot in a GitHub comment is
// private to the repo, and the browser cannot carry a GitHub login across
// origins, so the API streams the bytes same-origin, where the session
// cookie rides an <img> request. A bare id is a GitHub asset, found through
// the URL GitHub rendered for it; `<id>.<ext>` is a file on the repo's
// attachments branch, read straight from the Contents API.
import { ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "../../../../product-operations/types";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../authz";
import { createTtlCache } from "../../../ttl-cache";
import { SOURCES_CACHE_MAX_ENTRIES } from "./consts";
import { createAttachmentsHandlers } from "./handler";
import type { AttachmentsControllerDeps, RenderedSources } from "./types";

export function attachmentsRoute(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
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
  return app;
}
