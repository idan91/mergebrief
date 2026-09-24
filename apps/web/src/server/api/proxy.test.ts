// The proxy is the whole `/api/*` surface once the API runs as its own
// process, so these drive the real thing against a recording HTTP server: what
// arrives upstream, and what comes back, is what a caller would have seen from
// the in-process app.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiUnavailable, requestApi, type ApiTransportDeps } from "./proxy";

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

interface Upstream {
  readonly origin: string;
  readonly recorded: Recorded[];
  reply(handler: Replier): void;
  close(): Promise<void>;
}

type Replier = (
  request: Recorded,
  respond: (
    status: number,
    headers: Record<string, string | string[]>,
    body: string,
  ) => void,
) => void | Promise<void>;

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function startUpstream(): Promise<Upstream> {
  const recorded: Recorded[] = [];
  let replier: Replier = (_request, respond) => respond(200, {}, "{}");
  const server: Server = createServer((request, response) => {
    void (async () => {
      const entry: Recorded = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: await readBody(request),
      };
      recorded.push(entry);
      await replier(entry, (status, headers, body) => {
        response.writeHead(status, headers);
        response.end(body);
      });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    address !== null && typeof address === "object" ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    recorded,
    reply: (handler) => {
      replier = handler;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function transportFor(
  origin: string,
  timeoutMs = 5000,
  submitTimeoutMs = timeoutMs,
): ApiTransportDeps {
  return {
    origin,
    fetch: globalThis.fetch,
    logger: { error: vi.fn() },
    timeoutMs,
    submitTimeoutMs,
  };
}

let upstream: Upstream;

beforeEach(async () => {
  upstream = await startUpstream();
});

afterEach(async () => {
  await upstream.close();
});

describe("requestApi", () => {
  it("forwards the method, path and query byte for byte", async () => {
    const path = "/api/repos/42/pulls/7/marks?baseline=a%2Fb&head=c+d";
    await requestApi(
      new Request(`https://public.example${path}`, { method: "GET" }),
      transportFor(upstream.origin),
    );
    expect(upstream.recorded[0]?.method).toBe("GET");
    expect(upstream.recorded[0]?.url).toBe(path);
  });

  it("forwards a body's raw bytes so a signed payload still verifies", async () => {
    const payload = '{"zen":"a\\u00e9 \\u0000 body"}';
    await requestApi(
      new Request("https://public.example/api/webhooks/github", {
        method: "POST",
        body: payload,
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
      }),
      transportFor(upstream.origin),
    );
    expect(upstream.recorded[0]?.body.toString("utf8")).toBe(payload);
    expect(upstream.recorded[0]?.headers["x-hub-signature-256"]).toBe(
      "sha256=deadbeef",
    );
  });

  it("drops hop-by-hop headers and addresses the internal origin", async () => {
    await requestApi(
      new Request("https://public.example/api/pulls", {
        headers: {
          cookie: "__Host-mergebrief_session=abc",
          connection: "keep-alive",
          "accept-encoding": "gzip",
        },
      }),
      transportFor(upstream.origin),
    );
    const headers = upstream.recorded[0]?.headers ?? {};
    expect(headers["cookie"]).toBe("__Host-mergebrief_session=abc");
    expect(headers["accept-encoding"]).toBe("identity");
    expect(headers["host"]).toBe(upstream.origin.replace("http://", ""));
  });

  it("drops the caller address headers a client can set", async () => {
    await requestApi(
      new Request("https://public.example/api/pulls", {
        headers: {
          "x-forwarded-for": "203.0.113.9",
          "x-real-ip": "203.0.113.9",
          forwarded: "for=203.0.113.9",
        },
      }),
      transportFor(upstream.origin),
    );
    const headers = upstream.recorded[0]?.headers ?? {};
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers["forwarded"]).toBeUndefined();
  });

  it("keeps every Set-Cookie on its own header line", async () => {
    upstream.reply((_request, respond) =>
      respond(
        200,
        {
          "set-cookie": [
            "__Host-mergebrief_session=one; HttpOnly",
            "mergebrief_state=two; HttpOnly",
          ],
        },
        "{}",
      ),
    );
    const response = await requestApi(
      new Request("https://public.example/api/auth/github/callback"),
      transportFor(upstream.origin),
    );
    expect(response.headers.getSetCookie()).toEqual([
      "__Host-mergebrief_session=one; HttpOnly",
      "mergebrief_state=two; HttpOnly",
    ]);
  });

  it("hands a redirect back instead of following it", async () => {
    upstream.reply((_request, respond) =>
      respond(302, { location: "https://github.com/login/oauth" }, ""),
    );
    const response = await requestApi(
      new Request("https://public.example/api/auth/github"),
      transportFor(upstream.origin),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://github.com/login/oauth",
    );
    expect(upstream.recorded).toHaveLength(1);
  });

  it("passes the status and the no-store posture through", async () => {
    upstream.reply((_request, respond) =>
      respond(
        404,
        { "cache-control": "no-store", "content-type": "application/json" },
        '{"error":"not found","code":"not-found"}',
      ),
    );
    const response = await requestApi(
      new Request("https://public.example/api/repos/1/pulls/2"),
      transportFor(upstream.origin),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "not found",
      code: "not-found",
    });
  });

  it("answers a sanitized 503 when the API refuses the connection", async () => {
    const dead = upstream.origin;
    await upstream.close();
    const deps = transportFor(dead);
    const response = await requestApi(
      new Request("https://public.example/api/pulls"),
      deps,
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe(JSON.stringify({ error: "service unavailable" }));
    expect(body).not.toContain("127.0.0.1");
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
    upstream = await startUpstream();
  });

  it("gives the review submit POST its own longer budget", async () => {
    upstream.reply(
      (_request, respond) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            respond(200, {}, "{}");
            resolve();
          }, 120);
        }),
    );
    const deps = transportFor(upstream.origin, 40, 2000);
    const submitPath =
      "https://public.example/api/repos/42/pulls/7/review?base=a&head=b";
    const submitted = await requestApi(
      new Request(submitPath, { method: "POST", body: "{}" }),
      deps,
    );
    expect(submitted.status).toBe(200);
    const read = await requestApi(new Request(submitPath), deps);
    expect(read.status).toBe(504);
  });

  it("answers a sanitized 504 once the upstream budget runs out", async () => {
    upstream.reply(
      () =>
        new Promise<void>(() => {
          // Never responds; the timeout is the subject.
        }),
    );
    const response = await requestApi(
      new Request("https://public.example/api/pulls"),
      transportFor(upstream.origin, 40),
    );
    expect(response.status).toBe(504);
    expect(await response.text()).toContain("service unavailable");
  });

  it("stops at the caller's abort without sending a second request", async () => {
    upstream.reply(
      () =>
        new Promise<void>(() => {
          // Held open so the abort lands first.
        }),
    );
    const controller = new AbortController();
    const pending = requestApi(
      new Request("https://public.example/api/pulls", {
        signal: controller.signal,
      }),
      transportFor(upstream.origin),
    );
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    // At most the one attempt: an aborted mutation is never sent twice.
    expect(upstream.recorded.length).toBeLessThanOrEqual(1);
  });
});

describe("apiUnavailable", () => {
  it("answers a no-store body that names no internal detail", async () => {
    const response = apiUnavailable(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "service unavailable" });
  });
});
