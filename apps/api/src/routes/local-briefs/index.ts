// The dev-only local Brief file surface: the generator's out dir, read behind
// the session layer. Declared in every environment so the catalog never
// varies; with no directory configured each path answers as an unmounted one,
// ahead of any session check. Composition only.
import { ProductQueryIds } from "contract";
import { WriteClassifications } from "persistence";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import {
  createAbsentLocalBriefsHandlers,
  createLocalBriefsHandlers,
} from "./handler";
import type { LocalBriefsHandlers, LocalBriefsRouteDeps } from "./types";

function declareLocalBriefQueries(
  app: ProductRouter<AuthzEnv>,
  handlers: LocalBriefsHandlers,
): void {
  const read = WriteClassifications.READ;
  app.query(
    { id: ProductQueryIds.LIST_LOCAL_BRIEFS, classification: read },
    "/",
    handlers.listLocalBriefs,
  );
  app.query(
    { id: ProductQueryIds.READ_LOCAL_BRIEF, classification: read },
    "/:briefId",
    handlers.readLocalBrief,
  );
  app.query(
    { id: ProductQueryIds.READ_LOCAL_BRIEF_DIFFS, classification: read },
    "/:briefId/diffs",
    handlers.readLocalBriefDiffs,
  );
  app.query(
    { id: ProductQueryIds.READ_LOCAL_COMPARISON_MARKS, classification: read },
    "/:briefId/comparison-marks",
    handlers.readLocalComparisonMarks,
  );
  app.query(
    {
      id: ProductQueryIds.READ_LOCAL_REVISION_NARRATIVE,
      classification: read,
    },
    "/:briefId/revision-narrative",
    handlers.readLocalRevisionNarrative,
  );
}

export function localBriefsRoutes(
  deps: LocalBriefsRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const dir = deps.localBriefsDir;
  if (dir === undefined) {
    declareLocalBriefQueries(app, createAbsentLocalBriefsHandlers());
    return app;
  }

  app.use("*", sessionLayer(deps), accessStampLayer());
  declareLocalBriefQueries(app, createLocalBriefsHandlers({ dir }));
  return app;
}
