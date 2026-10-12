// `GET /api/capabilities`: the composed registry served as data, gated like
// every /api/* surface, the catalog fields in registry order, and a
// fingerprint that must byte-match the committed manifest (the drift
// tripwire in test form).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encryptToken,
  createEnvKeyProvider,
  createGrantAuth,
  createTokenAuth,
  WriteClassifications,
  type KeyProvider,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { shapeCatalogOperations } from "../src/product-operations/manifest";
import { productOperationRegistry } from "../src/product-operations/registry";
import { testLogger } from "./logging";
import { KEY_REF, brandReviewerId, buildAuthDeps } from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";

const MANIFEST_PATH = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "product-operations.manifest.json",
);

const bodySchema = z.object({
  operations: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      classification: z.string(),
      endpoint: z.string(),
    }),
  ),
  catalogFingerprint: z.string(),
});

describe("GET /api/capabilities", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
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

  afterEach(async () => {
    await harness.close();
  });

  async function bearer(): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const sealedAccess = await encryptToken(kp, KEY_REF, "ghu_ACCESS");
    const sealedRefresh = await encryptToken(kp, KEY_REF, "ghr_REFRESH");
    if (!sealedAccess.ok || !sealedRefresh.ok) {
      throw new Error("seed encrypt failed");
    }
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.READ,
      userId: brandReviewerId(555n),
      name: "ci-token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  it("serves the registry's catalog fields with its fingerprint, no-store", async () => {
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
    expect(body.catalogFingerprint).toBe(
      createHash("sha256")
        .update(readFileSync(MANIFEST_PATH, "utf8"))
        .digest("hex"),
    );
  });

  it("lists itself: read-capabilities appears in its own output", async () => {
    const token = await bearer();
    const res = await app.request("/api/capabilities", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = bodySchema.parse(await res.json());
    const self = body.operations.find((op) => op.id === "read-capabilities");
    expect(self).toEqual({
      id: "read-capabilities",
      kind: "query",
      classification: "read",
      endpoint: "GET /api/capabilities",
    });
  });

  it("is gated: no auth → hint-free 401", async () => {
    const res = await app.request("/api/capabilities");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "signed out",
      code: "signed-out",
    });
  });
});
