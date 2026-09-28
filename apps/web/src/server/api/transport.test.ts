// SSR forwards the viewer's cookie to the API so the render meets the same
// authorization the browser would. These pin that forwarding and the sanitized
// answer a broken transport gives, which is what keeps SSR from becoming a
// second authorization path.
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchToApi } from "./transport";
import type { ApiTransportDeps } from "./proxy";

interface Upstream {
  readonly origin: string;
  readonly cookies: (string | undefined)[];
  readonly paths: string[];
  close(): Promise<void>;
}

async function startUpstream(): Promise<Upstream> {
  const cookies: (string | undefined)[] = [];
  const paths: string[] = [];
  const server: Server = createServer((request, response) => {
    cookies.push(request.headers.cookie);
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
      "__Host-mergebrief_session=abc",
      deps(),
    );
    expect(response.status).toBe(200);
    expect(upstream.paths).toEqual(["/api/pulls"]);
    expect(upstream.cookies).toEqual(["__Host-mergebrief_session=abc"]);
  });

  it("sends no cookie when the incoming request carried none", async () => {
    await dispatchToApi("/api/pulls", undefined, deps());
    expect(upstream.cookies).toEqual([undefined]);
  });

  it("replaces a caller-supplied cookie whatever its casing", async () => {
    await dispatchToApi(
      "/api/pulls",
      "__Host-mergebrief_session=real",
      deps(),
      {
        headers: { Cookie: "__Host-mergebrief_session=stale" },
      },
    );
    expect(upstream.cookies).toEqual(["__Host-mergebrief_session=real"]);
  });

  it("drops a caller cookie entirely when the viewer has none", async () => {
    await dispatchToApi("/api/pulls", undefined, deps(), {
      headers: { cookie: "__Host-mergebrief_session=stale" },
    });
    expect(upstream.cookies).toEqual([undefined]);
  });

  it("carries a mutation's method and body to the API", async () => {
    await dispatchToApi("/api/repos/1/pulls/2/session/marks", "c=1", deps(), {
      method: "POST",
      body: '{"chunkId":"x"}',
      headers: { "content-type": "application/json" },
    });
    expect(upstream.paths).toEqual(["/api/repos/1/pulls/2/session/marks"]);
  });

  it("answers a sanitized 503 when the API cannot be reached", async () => {
    const dead = deps();
    await upstream.close();
    const response = await dispatchToApi("/api/pulls", undefined, dead);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe(JSON.stringify({ error: "service unavailable" }));
    expect(body).not.toContain("127.0.0.1");
    upstream = await startUpstream();
  });
});
