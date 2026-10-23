// `GET /api/capabilities`: the composed registry served as data, gated like
// every /api/* surface, the catalog fields in registry order.
import { createHash, randomBytes } from "node:crypto";
import {
  createEnvKeyProvider,
  createTokenAuth,
  type KeyProvider,
} from "persistence";
import { seedGrant } from "persistence/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { shapeCatalogOperations } from "../src/product-operations/catalog";
import { productOperationRegistry } from "../src/product-operations/registry";
import { testLogger } from "./logging";
import { KEY_REF, brandReviewerId, buildAuthDeps } from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { AccessLevels } from "types/access-levels";
import { registerSharedPglite } from "./shared-pglite";

const bodySchema = z.object({
  operations: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      classification: z.string(),
      endpoint: z.string(),
    }),
  ),
});

describe("GET /api/capabilities", () => {
  const harness = registerSharedPglite();
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(() => {
    kp = createEnvKeyProvider({
      [KEY_REF]: randomBytes(32).toString("base64"),
    });
    const auth: AuthDeps = buildAuthDeps(kp);
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth,
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  async function bearer(): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const grant = await seedGrant(harness.handle, {
      userId: brandReviewerId(555n),
      accessToken: "ghu_ACCESS",
      refreshToken: "ghr_REFRESH",
      keyProvider: kp,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTokenAuth(harness.handle).mintToken({
      scope: AccessLevels.READ,
      userId: brandReviewerId(555n),
      name: "ci-token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  it("serves the registry's catalog fields, no-store", async () => {
    const token = await bearer();
    const res = await app.request("/api/capabilities", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = bodySchema.parse(await res.json());
    expect(body.operations).toEqual(
      shapeCatalogOperations(productOperationRegistry.list()),
    );
  });
});
