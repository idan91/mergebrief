import { afterEach, describe, expect, it, vi } from "vitest";
import serverEntry from "./server";
import { getServerLogger } from "./server/logger";
import { REQUEST_ID_HEADER } from "./server/request-id";

const MINTED_ID = "00000000-0000-4000-8000-000000000001";

const rendered = vi.hoisted(() => ({ requests: [] as Request[] }));

vi.mock("./server/api/transport", () => ({
  getApiTransport: () => ({}),
}));

vi.mock("./server/api/proxy", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestApi: () => Promise.resolve(new Response("+a\n", { status: 200 })),
}));

vi.mock("@tanstack/react-start/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createStartHandler: () => (request: Request) => {
    rendered.requests.push(request);
    return Promise.reject(new Error("render blew up"));
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  rendered.requests.length = 0;
});

describe("server entry", () => {
  it("logs a failed render under the request id it minted", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(MINTED_ID);
    const serverLogger = getServerLogger();
    const logError = vi.spyOn(serverLogger, "error");
    logError.mockImplementation(() => undefined);
    const inbound = new Request("http://localhost/repos/1/pulls/2", {
      headers: { [REQUEST_ID_HEADER]: "client-chosen" },
    });

    const response = await serverEntry.fetch(inbound);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal error" });
    const renderedIds = rendered.requests.map((request) =>
      request.headers.get(REQUEST_ID_HEADER),
    );
    expect(renderedIds).toEqual([MINTED_ID]);
    const failureFields = { err: expect.any(Error), reqId: MINTED_ID };
    expect(logError).toHaveBeenCalledWith(
      "web request failed",
      expect.objectContaining(failureFields),
    );
  });

  it("gzips a proxied diff read for a browser that accepts it", async () => {
    const inbound = new Request("http://localhost/api/repos/1/pulls/2/diff", {
      headers: { "accept-encoding": "gzip" },
    });

    const response = await serverEntry.fetch(inbound);

    expect(response.headers.get("content-encoding")).toBe("gzip");
    const body = response.body?.pipeThrough(new DecompressionStream("gzip"));
    expect(await new Response(body).text()).toBe("+a\n");
  });
});
