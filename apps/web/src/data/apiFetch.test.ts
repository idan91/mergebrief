// apiFetch seam unit tests (BRIEF-19 PR 3.1). The SSR branch is exercised
// through `dispatchInProcess` with a fake Hono-shaped app — asserting the two
// invariants that make SSR *not* a second authz path (ADR 0016 #5c): the
// viewer's cookie is forwarded verbatim, and a composition failure maps to the
// same sanitized 503 the server entry answers, never a thrown internal error.
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiJsonFromResponse,
  dispatchInProcess,
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

  it("forwards method, body, and content-type for a mutation (BRIEF-23)", async () => {
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

  it("reports a composition failure through the injected log sink, with the cause as a structured field (ADR 0034)", async () => {
    // The seam is isomorphic, so the SSR branch cannot import the server
    // logger at module scope — it is injected. `error` is the right level:
    // the whole read surface is down until an operator acts.
    const sink = fakeLogSink();
    await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.4:5432");
      },
      sink,
    );
    expect(sink.error).toHaveBeenCalledTimes(1);
    const [msg, fields] = sink.error.mock.calls[0] ?? [];
    expect(msg).toBe("apiFetch: webhook app composition failed");
    expect(fields?.["err"]).toMatchObject({
      name: "Error",
      message: "connect ECONNREFUSED 10.0.0.4:5432",
    });
  });

  it("redacts URL-shaped credentials from the LOGGED error message and stack", async () => {
    // pino's `err` serializer writes message + stack VERBATIM, and
    // `packages/logging`'s redaction is key-path based — it cannot reach a
    // secret embedded in a STRING. Composition failures (migrate/createDb)
    // realistically throw with DATABASE_URL in the message, so the sanitizing
    // happens here, before the value ever reaches the logger.
    const sink = fakeLogSink();
    await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => {
        throw new Error("postgres://user:secret@host/db is down");
      },
      sink,
    );
    const [msg, fields] = sink.error.mock.calls[0] ?? [];
    const logged = JSON.stringify({ msg, fields });
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("postgres://");
    // Redacted, not dropped: the operator still gets a diagnosable line.
    const err = fields?.["err"];
    expect(err).toMatchObject({
      name: "Error",
      message: "[redacted-url] is down",
    });
    expect(typeof (err as { stack?: unknown } | undefined)?.stack).toBe(
      "string",
    );
  });

  it("keeps file:// stack frames intact while still redacting credentials", async () => {
    // apps/web is `"type": "module"`, so Node renders EVERY frame as
    // `file:///abs/path:10:5`. A blanket URL redaction would eat the whole
    // stack and hand the operator a blank trace — the `file://` scheme
    // carries no credentials and is exempt.
    const sink = fakeLogSink();
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
      sink,
    );
    const [, fields] = sink.error.mock.calls[0] ?? [];
    const stack = (fields?.["err"] as { stack?: string } | undefined)?.stack;
    expect(stack).toContain(
      "file:///Users/idan/app/src/server/webhookApp.ts:42:11",
    );
    expect(stack).toContain("file:///Users/idan/app/src/data/apiFetch.ts");
    // The credential-bearing first line is still redacted.
    expect(stack).not.toContain("secret");
    expect(stack).not.toContain("postgres://");
    expect(stack).toContain("[redacted-url]");
  });

  it("logs a non-Error throw without losing it", async () => {
    const sink = fakeLogSink();
    await dispatchInProcess(
      "/api/pulls",
      undefined,
      async () => {
        throw "postgres://user:secret@host/db is down";
      },
      sink,
    );
    const [, fields] = sink.error.mock.calls[0] ?? [];
    expect(JSON.stringify(fields)).not.toContain("secret");
    expect(fields?.["err"]).toMatchObject({
      message: "[redacted-url] is down",
    });
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
    [400, "bad-request"],
    [401, "unauthorized"],
    [404, "not-found"],
    [502, "upstream"],
    [503, "unavailable"],
  ])("throws a typed ApiError for %i", async (status, kind) => {
    const attempt = apiJsonFromResponse(new Response("{}", { status }), "/x");
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status, kind });
  });

  it("throws a malformed ApiError when a 2xx body is not JSON", async () => {
    const attempt = apiJsonFromResponse(
      new Response("<html>", { status: 200 }),
      "/x",
    );
    await expect(attempt).rejects.toMatchObject({ kind: "malformed" });
  });
});
