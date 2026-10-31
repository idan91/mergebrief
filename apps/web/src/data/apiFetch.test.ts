// apiFetch boundary unit tests: the wire-body mapping and the vocabulary this
// bundle answers with. The SSR branch itself now crosses a process boundary
// and is pinned in `server/api/transport.test.ts`.
import { describe, expect, it } from "vitest";
import type { ApiErrorCode as WireErrorCode } from "contract";
import type { Equals } from "types/utils";
import {
  ApiError,
  ApiErrorCodes,
  apiErrorSerializationAdapter,
  apiJsonFromResponse,
  errorFromResponse,
  opaqueErrorSerializationAdapter,
  type ApiErrorCode,
} from "./apiFetch";

type SerializedApiError = Parameters<
  typeof apiErrorSerializationAdapter.fromSerializable
>[0];

/** Through the adapter with a JSON hop between, as dehydration ships it. */
function runSerializationRoundTrip(error: ApiError): ApiError {
  const serialized = apiErrorSerializationAdapter.toSerializable(error);
  const shipped = JSON.parse(JSON.stringify(serialized)) as SerializedApiError;
  return apiErrorSerializationAdapter.fromSerializable(shipped);
}

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
    [502, "internal-error"],
    [503, "internal-error"],
    [504, "internal-error"],
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
  it("reads a codeless proxy 502 as the server, never GitHub", async () => {
    const error = await errorFromResponse(
      new Response("<html>bad gateway</html>", { status: 502 }),
      "/x",
    );
    expect(error.code).toBe(ApiErrorCodes.INTERNAL_ERROR);
    expect(error.status).toBe(502);
  });
});

type WebWireCode = Exclude<ApiErrorCode, "malformed">;
// Compile-time: this surface minus the web-local member IS the contract.
true satisfies Equals<WebWireCode, WireErrorCode>;

describe("apiErrorSerializationAdapter", () => {
  it("rebuilds an ApiError with its code and status, never its path", () => {
    const error = new ApiError(
      ApiErrorCodes.NOT_FOUND,
      404,
      "/api/local-briefs/missing",
    );
    const serialized = JSON.stringify(
      apiErrorSerializationAdapter.toSerializable(error),
    );

    const restored = runSerializationRoundTrip(error);

    expect(serialized).not.toContain("/api/local-briefs/missing");
    expect(restored).toBeInstanceOf(ApiError);
    expect(restored).toMatchObject({
      code: ApiErrorCodes.NOT_FOUND,
      status: 404,
      path: "",
    });
  });

  it("claims only ApiError, leaving other errors to the opaque adapter", () => {
    const apiError = new ApiError(ApiErrorCodes.NOT_FOUND, 404, "/x");

    expect(apiErrorSerializationAdapter.test(apiError)).toBe(true);
    expect(apiErrorSerializationAdapter.test(new Error("not-found"))).toBe(
      false,
    );
    expect(opaqueErrorSerializationAdapter.test(apiError)).toBe(false);
  });
});

describe("opaqueErrorSerializationAdapter", () => {
  it("ships any other error without its message", () => {
    const error = new TypeError("failed reading /api/repos/1/pulls/2");
    const serialized = JSON.stringify(
      opaqueErrorSerializationAdapter.toSerializable(error),
    );

    expect(opaqueErrorSerializationAdapter.test(error)).toBe(true);
    expect(serialized).not.toContain("/api/repos");
    expect(
      opaqueErrorSerializationAdapter.fromSerializable({ opaque: true }),
    ).toMatchObject({
      message: "",
    });
  });
});
