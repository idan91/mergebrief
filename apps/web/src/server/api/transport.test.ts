// SSR forwards the viewer's cookie to the API so the render meets the same
// authorization the browser would. These pin that forwarding and the sanitized
// answer a broken transport gives, which is what keeps SSR from becoming a
// second authorization path.
import { createServer, type Server } from "node:http";
import { createServerEntry } from "@tanstack/react-start/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stampRequestId } from "../request-id";
import { dispatchToApi, fetchFromApi } from "./transport";
import type { ApiTransportDeps } from "./proxy";

interface Upstream {
  readonly origin: string;
  readonly cookies: (string | undefined)[];
  readonly requestIds: (string | string[] | undefined)[];
  readonly paths: string[];
  close(): Promise<void>;
}

async function startUpstream(): Promise<Upstream> {
  const cookies: (string | undefined)[] = [];
  const requestIds: (string | string[] | undefined)[] = [];
  const paths: string[] = [];
  const server: Server = createServer((request, response) => {
    cookies.push(request.headers.cookie);
    requestIds.push(request.headers["x-request-id"]);
    paths.push(request.url ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    address !== null && typeof address === "object" ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    cookies,
    requestIds,
    paths,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

let upstream: Upstream;
function deps(): ApiTransportDeps {
  return {
    origin: upstream.origin,
    fetch: globalThis.fetch,
    logger: { error: vi.fn() },
    timeoutMs: 5000,
    submitTimeoutMs: 5000,
    uploadTimeoutMs: 5000,
  };
}

beforeEach(async () => {
  upstream = await startUpstream();
});

afterEach(async () => {
  await upstream.close();
});

describe("dispatchToApi", () => {
  it("sends the path to the API with the viewer's cookie attached", async () => {
    const response = await dispatchToApi(
      "/api/pulls",
      { cookie: "__Host-mergebrief_session=abc" },
      deps(),
    );
    expect(response.status).toBe(200);
    expect(upstream.paths).toEqual(["/api/pulls"]);
    expect(upstream.cookies).toEqual(["__Host-mergebrief_session=abc"]);
  });

  it("sends no cookie when the incoming request carried none", async () => {
    await dispatchToApi("/api/pulls", {}, deps());
    expect(upstream.cookies).toEqual([undefined]);
  });

  it("replaces a caller-supplied cookie whatever its casing", async () => {
    await dispatchToApi(
      "/api/pulls",
      { cookie: "__Host-mergebrief_session=real" },
      deps(),
      {
        headers: { Cookie: "__Host-mergebrief_session=stale" },
      },
    );
    expect(upstream.cookies).toEqual(["__Host-mergebrief_session=real"]);
  });

  it("drops a caller cookie entirely when the viewer has none", async () => {
    await dispatchToApi("/api/pulls", {}, deps(), {
      headers: { cookie: "__Host-mergebrief_session=stale" },
    });
    expect(upstream.cookies).toEqual([undefined]);
  });

  it("carries a mutation's method and body to the API", async () => {
    await dispatchToApi(
      "/api/repos/1/pulls/2/session/marks",
      { cookie: "c=1" },
      deps(),
      {
        method: "POST",
        body: '{"chunkId":"x"}',
        headers: { "content-type": "application/json" },
      },
    );
    expect(upstream.paths).toEqual(["/api/repos/1/pulls/2/session/marks"]);
  });

  it("sends the inbound request's id with every SSR call", async () => {
    await dispatchToApi("/api/pulls", { requestId: "minted-1" }, deps());
    await dispatchToApi("/api/version", { requestId: "minted-1" }, deps());
    expect(upstream.requestIds).toEqual(["minted-1", "minted-1"]);
  });

  it("replaces a caller-supplied request id with the inbound one", async () => {
    await dispatchToApi("/api/pulls", { requestId: "minted-1" }, deps(), {
      headers: { "X-Request-Id": "stale" },
    });
    expect(upstream.requestIds).toEqual(["minted-1"]);
  });

  it("answers a sanitized 503 when the API cannot be reached", async () => {
    const dead = deps();
    await upstream.close();
    const response = await dispatchToApi("/api/pulls", {}, dead);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe(JSON.stringify({ error: "service unavailable" }));
    expect(body).not.toContain("127.0.0.1");
    upstream = await startUpstream();
  });
});

describe("fetchFromApi", () => {
  it("sends the stamped id and cookie from the request it renders", async () => {
    vi.stubEnv("MERGEBRIEF_API_ORIGIN", upstream.origin);
    const inbound = new Request("http://localhost/pulls/1", {
      headers: { cookie: "session=abc", "x-request-id": "client-chosen" },
    });
    const { fetch: render } = createServerEntry({
      fetch: () => fetchFromApi("/api/inbox"),
    });

    await render(stampRequestId(inbound, "minted-id"), {});

    expect(upstream.requestIds).toEqual(["minted-id"]);
    expect(upstream.cookies).toEqual(["session=abc"]);
  });
});
