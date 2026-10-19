// `GET /api/spend`: the Instance's started runs today against its daily cap,
// for its Operators only. Mounted outside `/api/auth`, so an API token
// reaches it as a session does.
import { ProductQueryIds } from "contract";
import { DEFAULT_INSTANCE_POLICY } from "generators/instance-policy";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import type { AuthRouteDeps } from "../auth/session/types";
import { readSpend, type ReadSpendDeps } from "./read-spend";

const NO_STORE = { "cache-control": "no-store" } as const;

export interface SpendRouteDeps extends AuthRouteDeps {
  readonly spendPolicy?: ReadSpendDeps["spendPolicy"];
}

function createReadSpendHandler(deps: ReadSpendDeps): Handler<AuthzEnv> {
  return async (c) => {
    const spend = await readSpend(deps, new Date());

    return c.json(spend, HttpStatuses.OK, NO_STORE);
  };
}

export function spendRoute(deps: SpendRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const readDeps: ReadSpendDeps = {
    handle: deps.handle,
    spendPolicy: deps.spendPolicy ?? DEFAULT_INSTANCE_POLICY.spendPolicy,
  };
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.READ_SPEND,
      browserSessionOnly: false,
      requiresOperator: true,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    createReadSpendHandler(readDeps),
  );
  return app;
}
