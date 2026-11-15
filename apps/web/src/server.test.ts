import { SECURITY_RESPONSE_HEADERS } from "contract";
import { HttpMethods } from "types";
import { afterEach, describe, expect, it, vi } from "vitest";
import serverEntry from "./server";
import { timeApiRead } from "./server/api/read-timings";
import { getServerLogger } from "./server/logger";
import { REQUEST_ID_HEADER } from "./server/request-id";

const MINTED_ID = "00000000-0000-4000-8000-000000000001";

const rendered = vi.hoisted(() => ({
  requests: [] as Request[],
  page: undefined as Response | undefined,
  beforeRender: undefined as (() => Promise<unknown>) | undefined,
  apiReply: undefined as Response | undefined,
}));

vi.mock("./server/api/transport", () => ({
  getApiTransport: () => ({}),
}));

vi.mock("./server/api/proxy", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestApi: () =>
    Promise.resolve(rendered.apiReply ?? new Response("+a\n", { status: 200 })),
}));

vi.mock("@tanstack/react-start/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createStartHandler: () => async (request: Request) => {
    rendered.requests.push(request);
    await rendered.beforeRender?.();
    if (rendered.page !== undefined) {
      return rendered.page;
    }
    throw new Error("render blew up");
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  rendered.requests.length = 0;
  rendered.page = undefined;
  rendered.beforeRender = undefined;
  rendered.apiReply = undefined;
});

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

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

  it("reports a render's timed API read in Server-Timing", async () => {
    rendered.beforeRender = () =>
      timeApiRead(HttpMethods.GET, "/repos/1/pulls/2/brief", () =>
        Promise.resolve(),
      );
    rendered.page = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const response = await serverEntry.fetch(
      new Request("http://localhost/repos/1/pulls/2"),
    );

    const serverTiming = response.headers.get("server-timing") ?? "";
    expect(serverTiming).toMatch(
      /^api;desc="GET \/repos\/1\/pulls\/2\/brief @/,
    );
    expect(serverTiming).toContain("api-total;dur=");
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

describe("server entry security headers", () => {
  it("stamps a rendered document and keeps its no-store", async () => {
    rendered.page = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const response = await serverEntry.fetch(
      new Request("http://localhost/repos/1/pulls/2"),
    );

    expectSecurityHeaders(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("<html></html>");
  });

  it("stamps a failed render's answer", async () => {
    const serverLogger = getServerLogger();
    vi.spyOn(serverLogger, "error").mockImplementation(() => undefined);

    const response = await serverEntry.fetch(
      new Request("http://localhost/repos/1/pulls/2"),
    );

    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
  });

  it("stamps a proxied answer and keeps every cookie it set", async () => {
    const headers = new Headers({ location: "https://github.com/login" });
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    rendered.apiReply = new Response(null, { status: 302, headers });

    const response = await serverEntry.fetch(
      new Request("http://localhost/api/auth/github"),
    );

    expect(response.status).toBe(302);
    expectSecurityHeaders(response);
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("keeps the stricter policy a proxied attachment carries", async () => {
    const policy = "default-src 'none'; sandbox";
    rendered.apiReply = new Response("bytes", {
      headers: { "content-security-policy": policy },
    });

    const response = await serverEntry.fetch(
      new Request("http://localhost/api/repos/1/pulls/2/attachments/a"),
    );

    expect(response.headers.get("content-security-policy")).toBe(policy);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it.each(["/healthz", "/_serverFn/anything"])(
    "stamps what %s answers ahead of the page router",
    async (path) => {
      const response = await serverEntry.fetch(
        new Request(`http://localhost${path}`),
      );

      expectSecurityHeaders(response);
    },
  );
});
