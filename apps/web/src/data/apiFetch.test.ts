// apiFetch boundary unit tests. The SSR branch runs through
// `dispatchInProcess` with a fake Hono-shaped app, asserting the two invariants
// that keep SSR from becoming a second authz path: the viewer's cookie is
// forwarded verbatim, and a composition failure maps to the same sanitized 503
// the server entry answers, never a thrown internal error.
import { createLogger } from "logging";
import { describe, expect, it, vi } from "vitest";
import { ApiErrorCodes } from "api";
import type { ApiErrorCode as SourceApiErrorCode } from "api";
import type { Equals } from "types";
import {
  ApiError,
  ApiErrorCode,
  apiJsonFromResponse,
  dispatchInProcess,
  errorFromResponse,
  type DispatchLogSink,
} from "./apiFetch";

function fakeApp(handler: (request: Request) => Response) {
  return { fetch: vi.fn(async (request: Request) => handler(request)) };
}

function fakeLogSink() {
  return {
    error: vi.fn<DispatchLogSink["error"]>(() => {}),
  };
}

describe("dispatchInProcess", () => {
  it("dispatches the path against the app with the cookie forwarded", async () => {
    const app = fakeApp((request) => {
      expect(new URL(request.url).pathname).toBe("/api/pulls");
      expect(request.headers.get("cookie")).toBe("rs_session=abc");
      return new Response("{}", { status: 200 });
    });
    const res = await dispatchInProcess(
      "/api/pulls",
      "rs_session=abc",
      async () => app,
      fakeLogSink(),
    );
    expect(res.status).toBe(200);
    expect(app.fetch).toHaveBeenCalledTimes(1);
  });

  it("omits the cookie header when the incoming request carried none", async () => {
    const app = fakeApp((request) => {
      expect(request.headers.get("cookie")).toBeNull();
      return new Response("{}", { status: 401 });
    });
    const res = await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => app,
      fakeLogSink(),
    );
    expect(res.status).toBe(401);
  });

  it("forwards method, body, and content-type for a mutation", async () => {
    const app = fakeApp((request) => {
      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(request.headers.get("cookie")).toBe("rs_session=abc");
      return new Response('{"ok":true}', { status: 201 });
    });
    const res = await dispatchInProcess(
      "/api/repos/1/pulls/7/review",
      "rs_session=abc",
      async () => app,
      fakeLogSink(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"outcome":"comment"}',
      },
    );
    expect(res.status).toBe(201);
    const sent = app.fetch.mock.calls[0]?.[0];
    if (sent === undefined) throw new Error("expected a dispatched request");
    expect(await sent.text()).toBe('{"outcome":"comment"}');
  });

  it("the viewer cookie wins over a case-variant Cookie init header", async () => {
    // Headers are case-insensitive: a caller-supplied `Cookie` must not merge
    // with (and shadow or pollute) the forwarded viewer cookie.
    const app = fakeApp((request) => {
      expect(request.headers.get("cookie")).toBe("rs_session=real");
      return new Response("{}", { status: 200 });
    });
    const res = await dispatchInProcess(
      "/api/pulls",
      "rs_session=real",
      async () => app,
      fakeLogSink(),
      { headers: { Cookie: "rs_session=stale" } },
    );
    expect(res.status).toBe(200);
  });

  it("maps a composition failure to the sanitized 503, never a throw", async () => {
    const res = await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => {
        throw new Error("postgres://user:secret@host/db is down");
      },
      fakeLogSink(),
    );
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain("secret");
    expect(body).toContain("service unavailable");
  });

  it("reports a composition failure through the injected log sink, with the raw cause as the err field", async () => {
    // The boundary is isomorphic, so the SSR branch cannot import the server
    // logger at module scope — it is injected. The RAW error rides `err`;
    // scrubbing is the logging boundary's job, not this call site's.
    const sink = fakeLogSink();
    const cause = new Error("connect ECONNREFUSED 10.0.0.4:5432");
    await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => {
        throw cause;
      },
      sink,
    );
    expect(sink.error).toHaveBeenCalledTimes(1);
    const [msg, fields] = sink.error.mock.calls[0] ?? [];
    expect(msg).toBe("apiFetch: webhook app composition failed");
    expect(fields?.["err"]).toBe(cause);
  });

  // With the REAL logger injected, the boundary's err serializer scrubs
  // URL-shaped credentials before the line is emitted.
  it("emits no credentials through the real logging seam", async () => {
    const written: string[] = [];
    const logger = createLogger({
      env: {},
      destination: { write: (line: string) => written.push(line) },
    });
    const cause = new Error("postgres://user:secret@host/db is down");
    cause.stack = [
      "Error: postgres://user:secret@host/db is down",
      "    at buildWebhookApp (file:///Users/idan/app/src/server/webhookApp.ts:42:11)",
      "    at async dispatchInProcess (file:///Users/idan/app/src/data/apiFetch.ts:130:15)",
    ].join("\n");
    await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => {
        throw cause;
      },
      logger,
    );
    const line = written[0];
    if (line === undefined) {
      throw new Error("expected an emitted log line");
    }
    expect(line).not.toContain("secret");
    expect(line).not.toContain("postgres://");
    expect(line).toContain("[redacted-url]");
    // ESM stack frames survive — the operator keeps a usable trace.
    expect(line).toContain(
      "file:///Users/idan/app/src/server/webhookApp.ts:42:11",
    );
  });

  it("logs a non-Error throw without losing it, scrubbed by the seam", async () => {
    const written: string[] = [];
    const logger = createLogger({
      env: {},
      destination: { write: (line: string) => written.push(line) },
    });
    await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => {
        throw "postgres://user:secret@host/db is down";
      },
      logger,
    );
    const line = written[0];
    expect(line).toBeDefined();
    expect(line).not.toContain("secret");
    expect(line).toContain("[redacted-url] is down");
  });
});

describe("apiJsonFromResponse", () => {
  it("returns the parsed body on 2xx", async () => {
    const value = await apiJsonFromResponse(
      new Response('{"pulls":[]}', { status: 200 }),
      "/api/pulls",
    );
    expect(value).toEqual({ pulls: [] });
  });

  it.each([
    [400, "invalid-request"],
    [401, "unauthorized"],
    [404, "not-found"],
    [409, "pr-changed-since-read"],
    [413, "request-too-large"],
    [500, "internal-error"],
    [502, "github-unavailable"],
    [503, "github-unavailable"],
  ])(
    "throws a typed ApiError with the status-bucket code for a codeless %i",
    async (status, code) => {
      const attempt = apiJsonFromResponse(new Response("{}", { status }), "/x");
      await expect(attempt).rejects.toBeInstanceOf(ApiError);
      await expect(attempt).rejects.toMatchObject({ status, code });
    },
  );

  it("prefers the wire code over the status bucket", async () => {
    const attempt = apiJsonFromResponse(
      new Response(
        '{"error":"diff too large to render","code":"diff-too-large"}',
        {
          status: 413,
        },
      ),
      "/x",
    );
    await expect(attempt).rejects.toMatchObject({
      status: 413,
      code: "diff-too-large",
    });
  });

  it("keeps validated generation-config params on the typed error", async () => {
    const attempt = apiJsonFromResponse(
      new Response(
        JSON.stringify({
          error: "ANTHROPIC_API_KEY is required",
          code: "generation-config",
          params: { detail: "ANTHROPIC_API_KEY is required" },
        }),
        { status: 503 },
      ),
      "/api/generate",
    );
    await expect(attempt).rejects.toMatchObject({
      code: "generation-config",
      params: { detail: "ANTHROPIC_API_KEY is required" },
    });
  });

  it("drops malformed params instead of trusting the wire body", async () => {
    const error = await errorFromResponse(
      new Response(
        JSON.stringify({
          error: "x",
          code: "generation-config",
          params: { detail: 42 },
        }),
        { status: 503 },
      ),
      "/api/generate",
    );
    expect(error.params).toBeUndefined();
  });

  it("ignores an unknown wire code and keeps the status bucket", async () => {
    const attempt = apiJsonFromResponse(
      new Response('{"error":"x","code":"brand-new-code"}', { status: 404 }),
      "/x",
    );
    await expect(attempt).rejects.toMatchObject({ code: "not-found" });
  });

  it("never accepts the web-local malformed code from the wire", async () => {
    const attempt = apiJsonFromResponse(
      new Response('{"error":"x","code":"malformed"}', { status: 400 }),
      "/x",
    );
    await expect(attempt).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("throws a malformed ApiError when a 2xx body is not JSON", async () => {
    const attempt = apiJsonFromResponse(
      new Response("<html>", { status: 200 }),
      "/x",
    );
    await expect(attempt).rejects.toMatchObject({ code: "malformed" });
  });
});

describe("errorFromResponse", () => {
  it("tolerates a non-JSON error body", async () => {
    const error = await errorFromResponse(
      new Response("<html>bad gateway</html>", { status: 502 }),
      "/x",
    );
    expect(error.code).toBe(ApiErrorCode.GITHUB_UNAVAILABLE);
    expect(error.status).toBe(502);
  });
});

describe("wire vocabulary mirror (drift pins)", () => {
  type WebWireCode = Exclude<ApiErrorCode, "malformed">;
  // Compile-time: the mirror minus the web-local member IS the api vocabulary.
  true satisfies Equals<WebWireCode, SourceApiErrorCode>;

  it("runtime vocabulary equals the api's, plus only malformed", () => {
    const web = Object.values(ApiErrorCode);
    const source = Object.values(ApiErrorCodes);
    expect(web.filter((code) => code !== "malformed").toSorted()).toEqual(
      [...source].toSorted(),
    );
    expect(web).toContain("malformed");
  });
});
