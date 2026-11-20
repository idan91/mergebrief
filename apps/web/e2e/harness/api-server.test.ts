// The occupied-port refusal. Playwright's `webServer` rejected an existing
// server on the port; starting the API from globalSetup lost that, and a
// stranger answering `/readyz` would be taken for our own child.
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

let squatter: Server | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (squatter === undefined) {
    return;
  }
  await new Promise<void>((resolve) => squatter?.close(() => resolve()));
  squatter = undefined;
});

/**
 * Holds a port the system picks and resolves with it. Never the suite's own
 * API port: a browser run in progress on this machine is listening there.
 */
function occupyFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((_request, response) => {
      // Answers readiness exactly as the real API would.
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    squatter = server;
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the squatter has no port"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("startApiServer", () => {
  it("refuses a port another process already holds", async () => {
    const port = await occupyFreePort();
    vi.stubEnv("MERGEBRIEF_E2E_API_PORT", String(port));
    const { startApiServer } = await import("./api-server");
    const refusal = startApiServer();

    await expect(refusal).rejects.toThrow(
      `e2e api port ${String(port)} is already in use`,
    );
    await expect(refusal).rejects.toThrow("MERGEBRIEF_E2E_API_PORT");
  });
});
