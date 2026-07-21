// queryFn-level tests (codex PR4 R1 + the AGENTS.md invariant): component
// tests seed the cache and BYPASS the wire parser — these prove the apiFetch
// seam actually runs the parser and surfaces a typed MALFORMED for bad 200
// bodies (the BRIEF-21 parseDeltaBrief lesson).
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { ApiError, ApiErrorKind, apiFetchJson } from "../../data/apiFetch";
import { tokensQueryOptions } from "./queries";

const apiFetchJsonMock = vi.mocked(apiFetchJson);

afterEach(() => {
  vi.clearAllMocks();
});

async function runQueryFn(): Promise<unknown> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return client.fetchQuery(tokensQueryOptions());
}

describe("tokensQueryOptions queryFn", () => {
  it("parses a realistic wire body through the boundary guard", async () => {
    apiFetchJsonMock.mockResolvedValue({
      tokens: [
        {
          id: "3",
          name: "ci-token",
          installationId: "987654",
          userLogin: "octocat",
          expiresAt: "2026-10-07T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-07-09T12:00:00.000Z",
        },
      ],
    });
    const view = await runQueryFn();
    expect(view).toEqual({
      tokens: [expect.objectContaining({ id: "3", name: "ci-token" })],
    });
    expect(apiFetchJsonMock).toHaveBeenCalledWith("/api/auth/tokens");
  });

  it("rejects a malformed 200 body with a typed MALFORMED error", async () => {
    apiFetchJsonMock.mockResolvedValue({ tokens: [{ id: 3 }] });
    const failure = await runQueryFn().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    if (!(failure instanceof ApiError)) throw new Error("unreachable");
    expect(failure.kind).toBe(ApiErrorKind.MALFORMED);
  });
});

describe("mintToken transport", () => {
  it("maps an invalid 201 body to the typed MALFORMED error", async () => {
    const { mintToken } = await import("./queries");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 201 })),
    );
    const failure = await mintToken({
      name: "x",
      installationId: "111",
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    vi.unstubAllGlobals();
    expect(failure).toBeInstanceOf(ApiError);
    if (!(failure instanceof ApiError)) throw new Error("unreachable");
    expect(failure.kind).toBe(ApiErrorKind.MALFORMED);
  });
});
