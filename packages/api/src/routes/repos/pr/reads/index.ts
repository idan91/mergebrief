// The reviewer read API, behind the pr subtree's shared gate: PR meta, the
// stored artifacts (brief / brief-context / marks / delta / narrative), and
// the LIVE diff proxy (viewer token, per-session ~60s cache, NEVER
// persisted). Composition only; the diff cache is created here — once per
// `createApp` — so it is scoped to the app instance.
import { PRODUCT_QUERY_ID } from "../../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../../product-operations/types";
import type { AuthRouteDeps } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import { createTtlCache } from "../../../ttl-cache";
import { DIFF_CACHE_MAX_ENTRIES } from "./consts";
import createReadsHandlers from "./handler";

export function readsRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  // key `${sessionHash}:${repoId}:${prNumber}:${base}:${head}` → cached diff.
  const diffCache = createTtlCache<string>(DIFF_CACHE_MAX_ENTRIES);
  const handlers = createReadsHandlers(deps, diffCache);
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_PULL,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    handlers.readPull,
  );
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_BRIEF,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/brief",
    handlers.readBrief,
  );
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_MARKS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/marks",
    handlers.readMarks,
  );
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_DELTA,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/delta",
    handlers.readDelta,
  );
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_NARRATIVE,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/narrative",
    handlers.readNarrative,
  );
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_BRIEF_CONTEXT,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/brief-context",
    handlers.readBriefContext,
  );
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_DIFF,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/diff",
    handlers.readDiff,
  );
  return app;
}
