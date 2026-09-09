// apiFetch boundary unit tests: the wire-body mapping and the vocabulary this
// bundle answers with. The SSR branch itself now crosses a process boundary
// and is pinned in `server/api/transport.test.ts`.
import { describe, expect, it } from "vitest";
import {
  ApiErrorCodes as WireErrorCodes,
  type ApiErrorCode as WireErrorCode,
} from "contract";
import type { Equals } from "types";
import {
  ApiError,
  ApiErrorCodes,
  apiJsonFromResponse,
  errorFromResponse,
  type ApiErrorCode,
} from "./apiFetch";

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
    expect(error.code).toBe(ApiErrorCodes.GITHUB_UNAVAILABLE);
    expect(error.status).toBe(502);
  });
});

describe("wire vocabulary", () => {
  type WebWireCode = Exclude<ApiErrorCode, "malformed">;
  // Compile-time: this surface minus the web-local member IS the contract.
  true satisfies Equals<WebWireCode, WireErrorCode>;

  it("adds malformed to the contract vocabulary and nothing else", () => {
    const web: readonly string[] = Object.values(ApiErrorCodes);
    const wire: readonly string[] = Object.values(WireErrorCodes);
    expect(web.filter((code) => code !== "malformed").toSorted()).toEqual(
      wire.toSorted(),
    );
    expect(web).toContain("malformed");
  });
});
