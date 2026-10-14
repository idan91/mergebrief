// @vitest-environment jsdom
// queryFn-level tests: component tests seed the cache and BYPASS the wire
// parser, so these prove each call runs its parser and surfaces a typed
// MALFORMED for a bad 2xx body.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../data/apiFetch", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch,
}));

const { buildTokensQueryOptions, mintToken, revokeToken } =
  await import("./queries");

const WIRE_TOKEN = {
  id: "3",
  name: "ci-token",
  scope: "read",
  userLogin: "octocat",
  expiresAt: "2026-10-07T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-07-09T12:00:00.000Z",
};

function makeJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

async function runQueryFn(): Promise<unknown> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return client.fetchQuery(buildTokensQueryOptions());
}

describe("buildTokensQueryOptions queryFn", () => {
  it("parses a realistic wire body through the boundary guard", async () => {
    apiFetch.mockResolvedValue(makeJsonResponse({ tokens: [WIRE_TOKEN] }, 200));
    const view = await runQueryFn();
    expect(view).toEqual({
      tokens: [expect.objectContaining({ id: "3", name: "ci-token" })],
    });
    expect(apiFetch).toHaveBeenCalledWith("/api/auth/tokens", {
      method: "GET",
    });
  });

  it("rejects a malformed 200 body with a typed MALFORMED error", async () => {
    apiFetch.mockResolvedValue(makeJsonResponse({ tokens: [{ id: 3 }] }, 200));
    await expect(runQueryFn()).rejects.toMatchObject({ code: "malformed" });
  });
});

describe("mintToken", () => {
  it("posts the body and returns the token with its metadata", async () => {
    apiFetch.mockResolvedValue(
      makeJsonResponse({ token: "mergebrief_x", apiToken: WIRE_TOKEN }, 201),
    );
    const minted = await mintToken({
      name: "ci",
      scope: "read",
      expiresInDays: null,
    });
    expect(minted.token).toBe("mergebrief_x");
    expect(minted.apiToken.name).toBe("ci-token");
    expect(apiFetch).toHaveBeenCalledWith("/api/auth/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ci", scope: "read", expiresInDays: null }),
    });
  });

  it("maps an invalid 201 body to the typed MALFORMED error", async () => {
    apiFetch.mockResolvedValue(new Response("not json", { status: 201 }));
    await expect(mintToken({ name: "x", scope: "read" })).rejects.toMatchObject(
      { code: "malformed" },
    );
  });

  it("preserves a refusal's wire code", async () => {
    apiFetch.mockResolvedValue(
      makeJsonResponse({ error: "x", code: "invalid-request" }, 400),
    );
    await expect(mintToken({ name: "x", scope: "read" })).rejects.toMatchObject(
      { status: 400, code: "invalid-request" },
    );
  });
});

describe("revokeToken", () => {
  it("deletes the token by its encoded id", async () => {
    apiFetch.mockResolvedValue(
      makeJsonResponse({ apiToken: { ...WIRE_TOKEN, revokedAt: "x" } }, 200),
    );
    await expect(revokeToken("3/../4")).resolves.toBeUndefined();
    expect(apiFetch).toHaveBeenCalledWith("/api/auth/tokens/3%2F..%2F4", {
      method: "DELETE",
    });
  });

  it("throws a refusal's typed error", async () => {
    apiFetch.mockResolvedValue(
      makeJsonResponse({ error: "x", code: "not-found" }, 404),
    );
    await expect(revokeToken("3")).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
  });
});
