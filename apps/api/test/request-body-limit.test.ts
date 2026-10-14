// The request-body cap at the composition root: it answers before the
// session layer, so these requests carry no credential.
import { randomBytes } from "node:crypto";
import { ProductActionIds } from "contract";
import { createEnvKeyProvider } from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { productOperationRegistry } from "../src/product-operations/registry";
import { MAX_REQUEST_BODY_BYTES } from "../src/routes/wire-bounds";
import { testLogger } from "./logging";
import { KEY_REF, buildAuthDeps } from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";

const JSON_HEADERS = { "content-type": "application/json" };
const OVERSIZED = JSON.stringify({ body: "x".repeat(MAX_REQUEST_BODY_BYTES) });
const STREAM_CHUNK_BYTES = 64 * 1024;
const PATH_PARAM = /:[A-Za-z]+/g;

function getUploadPath(): string {
  const upload = productOperationRegistry
    .list()
    .find((descriptor) => descriptor.id === ProductActionIds.UPLOAD_ATTACHMENT);
  if (upload === undefined) {
    throw new Error("the upload operation is not registered");
  }
  const [, path = ""] = upload.endpoint.split(" ");
  return path.replace(PATH_PARAM, "1");
}

function streamBytes(total: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(STREAM_CHUNK_BYTES));
      sent += STREAM_CHUNK_BYTES;
    },
  });
}

describe("request body cap", () => {
  let harness: PgliteHarness;
  let app: ApiApp;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    const keys = createEnvKeyProvider({
      [KEY_REF]: randomBytes(32).toString("base64"),
    });
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth: buildAuthDeps(keys),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  afterEach(async () => {
    await harness.close();
  });

  it("refuses a declared body over the cap with request-too-large", async () => {
    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: JSON_HEADERS,
      body: OVERSIZED,
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "request-too-large" });
  });

  it("refuses a streamed body that crosses the cap mid-read", async () => {
    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: { ...JSON_HEADERS, "transfer-encoding": "chunked" },
      body: streamBytes(MAX_REQUEST_BODY_BYTES + STREAM_CHUNK_BYTES),
      duplex: "half",
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "request-too-large" });
  });

  it("lets a body under the cap reach the session layer", async () => {
    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ version: "1.6.0" }),
    });

    expect(res.status).toBe(401);
  });

  it("leaves the attachment upload to its own larger cap", async () => {
    const res = await app.request(getUploadPath(), {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(MAX_REQUEST_BODY_BYTES + 1),
    });

    expect(res.status).toBe(401);
  });
});
