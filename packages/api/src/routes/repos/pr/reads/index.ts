// The stored-artifact reads (brief / marks / delta / narrative), behind the
// pr subtree's shared gate. The remaining reads (PR meta, brief-context, the
// live diff proxy) still live in `../reads.ts` until their conversion.
import type { AppDatabase } from "persistence";
import { PRODUCT_QUERY_ID } from "../../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../../product-operations/types";
import type { AuthzEnv } from "../../../authz";
import createReadsHandlers from "./handler";

export function artifactReadsRoute(
  handle: AppDatabase,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createReadsHandlers(handle);
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
  return app;
}
