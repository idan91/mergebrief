// The occupied-port refusal. Playwright's `webServer` rejected an existing
// server on the port; starting the API from globalSetup lost that, and a
// stranger answering `/readyz` would be taken for our own child.
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { E2E_API_PORT } from "./env";
import { startApiServer } from "./api-server";

let squatter: Server | undefined;

afterEach(async () => {
  if (squatter === undefined) return;
  await new Promise<void>((resolve) => squatter?.close(() => resolve()));
  squatter = undefined;
});

function occupyApiPort(): Promise<void> {
  return new Promise((resolve) => {
    squatter = createServer((_request, response) => {
      // Answers readiness exactly as the real API would.
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    squatter.listen(E2E_API_PORT, "127.0.0.1", () => resolve());
  });
}

describe("startApiServer", () => {
  it("refuses a port another process already holds", async () => {
    await occupyApiPort();
    await expect(startApiServer()).rejects.toThrow(
      `e2e api port ${String(E2E_API_PORT)} is already in use`,
    );
  });

  it("names the override in the refusal", async () => {
    await occupyApiPort();
    await expect(startApiServer()).rejects.toThrow("MERGEBRIEF_E2E_API_PORT");
  });
});
