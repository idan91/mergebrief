import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  isRefusedRedirect,
  NO_REDIRECT_FETCH_OPTIONS,
} from "../src/adapters/utils";

const HTTP_TEMPORARY_REDIRECT = 307;

let server: Server | undefined;

/** A local server that answers every request with a redirect to another host. */
async function startRedirectingServer(): Promise<string> {
  const started = createServer((_request, response) => {
    response.writeHead(HTTP_TEMPORARY_REDIRECT, {
      location: "http://127.0.0.1:1/elsewhere",
    });
    response.end();
  });
  server = started;
  await new Promise<void>((resolve) => {
    started.listen(0, "127.0.0.1", resolve);
  });
  const { port } = started.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1/messages`;
}

async function catchRejection(request: Promise<unknown>): Promise<unknown> {
  try {
    await request;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to reject");
}

describe("a redirect the runtime's own fetch refuses", () => {
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("rejects in the words the redirect check reads", async () => {
    const address = await startRedirectingServer();
    const request = fetch(address, {
      ...NO_REDIRECT_FETCH_OPTIONS,
      method: "POST",
      body: "{}",
    });

    const error = await catchRejection(request);

    expect(isRefusedRedirect(error)).toBe(true);
  });
});
