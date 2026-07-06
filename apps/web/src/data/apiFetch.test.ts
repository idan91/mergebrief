// apiFetch seam unit tests (BRIEF-19 PR 3.1). The SSR branch is exercised
// through `dispatchInProcess` with a fake Hono-shaped app — asserting the two
// invariants that make SSR *not* a second authz path (ADR 0016 #5c): the
// viewer's cookie is forwarded verbatim, and a composition failure maps to the
// same sanitized 503 the server entry answers, never a thrown internal error.
import { describe, expect, it, vi } from "vitest";
import { ApiError, apiJsonFromResponse, dispatchInProcess } from "./apiFetch";

function fakeApp(handler: (request: Request) => Response) {
  return { fetch: vi.fn(async (request: Request) => handler(request)) };
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
    );
    expect(res.status).toBe(401);
  });

  it("maps a composition failure to the sanitized 503, never a throw", async () => {
    const res = await dispatchInProcess("/api/pulls", undefined, async () => {
      throw new Error("postgres://user:secret@host/db is down");
    });
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain("secret");
    expect(body).toContain("service unavailable");
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
