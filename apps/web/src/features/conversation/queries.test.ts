// queryFn behavior for the conversation GET: expected failure statuses are
// RESULT KINDS the section renders inline, a 200 parses through the boundary
// guard (route tests that seed the cache bypass it), and only a malformed 200
// throws typed.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../data/apiFetch";
import {
  buildCollaboratorsQueryOptions,
  buildConversationQueryOptions,
} from "./queries";

const apiFetchMock = vi.mocked(apiFetch);

function run(): Promise<unknown> {
  const options = buildConversationQueryOptions("42", 7);
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

function emptyConversation(): unknown {
  return {
    threads: [],
    reviews: [],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

describe("buildConversationQueryOptions queryFn", () => {
  it("parses a 200 into the ready conversation", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify(emptyConversation()), { status: 200 }),
    );
    await expect(run()).resolves.toEqual({
      kind: "ready",
      conversation: {
        threads: [],
        reviews: [],
        prComments: [],
        hasMoreThreads: false,
        hasMoreReviews: false,
        hasMorePrComments: false,
      },
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/42/pulls/7/conversation",
    );
  });

  it("maps a 401 to the unauthorized state after the session expires", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(run()).resolves.toEqual({ kind: "unauthorized" });
  });

  it("maps a 404 to not-found when the PR or conversation is gone", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(run()).resolves.toEqual({ kind: "not-found" });
  });

  it("maps a 502 to the unavailable state with no fallback", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
    await expect(run()).resolves.toEqual({ kind: "unavailable" });
  });

  it("throws a typed malformed error on a 200 with a bad shape", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
    );
    await expect(run()).rejects.toBeInstanceOf(ApiError);
  });

  it("maps a 503 to the unavailable state too", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(run()).resolves.toEqual({ kind: "unavailable" });
  });

  it("locks refresh: 30s stale, refetch on mount and focus, no retry", () => {
    const options = buildConversationQueryOptions("42", 7);
    expect(options.staleTime).toBe(30_000);
    expect(options.retry).toBe(false);
    expect(options.refetchOnMount).toBe("always");
    expect(options.refetchOnWindowFocus).toBe("always");
  });

  it("never polls: no refetchInterval on the descriptor", () => {
    const options = buildConversationQueryOptions("42", 7);
    expect(
      "refetchInterval" in options && options.refetchInterval !== undefined,
    ).toBe(false);
  });
});

function runCollaborators(): Promise<unknown> {
  const options = buildCollaboratorsQueryOptions("42");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

describe("buildCollaboratorsQueryOptions queryFn", () => {
  it("parses a 200 into alphabetically ordered candidates as the ranking", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          collaborators: [
            { login: "zed", avatarUrl: "https://avatars.example/zed.png" },
            { login: "alice", name: "Alice Example" },
          ],
          hasMore: false,
        }),
        { status: 200 },
      ),
    );
    await expect(runCollaborators()).resolves.toEqual({
      kind: "ready",
      candidates: [
        { login: "alice", name: "Alice Example" },
        { login: "zed", avatarUrl: "https://avatars.example/zed.png" },
      ],
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/repos/42/collaborators");
  });

  it("drops a non-https avatarUrl but keeps the entry", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          collaborators: [
            { login: "mallory", avatarUrl: "javascript:alert(1)" },
          ],
          hasMore: false,
        }),
        { status: 200 },
      ),
    );
    await expect(runCollaborators()).resolves.toEqual({
      kind: "ready",
      candidates: [{ login: "mallory" }],
    });
  });

  it("maps every expected failure status to unavailable, 404 included", async () => {
    for (const status of [401, 404, 502, 503]) {
      apiFetchMock.mockResolvedValue(new Response("{}", { status }));
      await expect(runCollaborators()).resolves.toEqual({
        kind: "unavailable",
      });
    }
  });

  it("throws a typed malformed error on a 200 with a bad shape", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
    );
    await expect(runCollaborators()).rejects.toBeInstanceOf(ApiError);
  });

  it("locks the refresh policy: long staleTime, no retry, no poll", () => {
    const options = buildCollaboratorsQueryOptions("42");
    expect(options.staleTime).toBe(5 * 60 * 1000);
    expect(options.retry).toBe(false);
    expect(
      "refetchInterval" in options && options.refetchInterval !== undefined,
    ).toBe(false);
  });
});
