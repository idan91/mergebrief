// The Operator gate: an operation that states `requiresOperator` answers only
// a principal whose GitHub user id the Instance's config lists.
import type { MiddlewareHandler } from "hono";
import { ApiErrorCodes, ProductQueryIds } from "contract";
import { AccessLevels } from "types";
import { describe, expect, it } from "vitest";
import { productRouter } from "../src/product-operations/product-router";
import { OPEN_POLICY } from "./fixtures";

const OPERATOR_ID = 583231n;
const OTHER_ID = 9919n;
const OPERATOR_QUERY = {
  id: ProductQueryIds.LIST_INBOX,
  ...OPEN_POLICY,
  requiresOperator: true,
} as const;

interface GateEnv {
  Variables: {
    session: { scope: string; reviewerId: bigint; channel: string };
    operatorIds: ReadonlySet<bigint>;
  };
}

interface PrincipalOptions {
  readonly reviewerId?: bigint;
  readonly channel?: string;
  readonly operatorIds?: ReadonlySet<bigint>;
}

function stubPrincipal(options: PrincipalOptions): MiddlewareHandler<GateEnv> {
  return async (c, next) => {
    if (options.reviewerId !== undefined) {
      c.set("session", {
        scope: AccessLevels.READ,
        reviewerId: options.reviewerId,
        channel: options.channel ?? "cookie",
      });
    }
    if (options.operatorIds !== undefined) {
      c.set("operatorIds", options.operatorIds);
    }
    await next();
  };
}

async function requestAs(options: PrincipalOptions): Promise<Response> {
  const router = productRouter<GateEnv>();
  router.use(stubPrincipal(options));
  router.query(OPERATOR_QUERY, "/spend", (c) => c.json({ ok: true }));
  return router.app.request("/spend");
}

describe("operator gate", () => {
  it("answers a listed Operator", async () => {
    const res = await requestAs({
      reviewerId: OPERATOR_ID,
      operatorIds: new Set([OPERATOR_ID]),
    });

    expect(res.status).toBe(200);
  });

  it("answers a listed Operator on an API token", async () => {
    const res = await requestAs({
      reviewerId: OPERATOR_ID,
      channel: "bearer",
      operatorIds: new Set([OPERATOR_ID]),
    });

    expect(res.status).toBe(200);
  });

  it("refuses a viewer the config does not list with 403 operator-only", async () => {
    const res = await requestAs({
      reviewerId: OTHER_ID,
      operatorIds: new Set([OPERATOR_ID]),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: ApiErrorCodes.OPERATOR_ONLY,
    });
  });

  it("refuses everyone when no Operator list reached the request", async () => {
    const res = await requestAs({ reviewerId: OPERATOR_ID });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: ApiErrorCodes.OPERATOR_ONLY,
    });
  });

  it("answers 401 without a principal", async () => {
    const res = await requestAs({ operatorIds: new Set([OPERATOR_ID]) });

    expect(res.status).toBe(401);
  });
});
