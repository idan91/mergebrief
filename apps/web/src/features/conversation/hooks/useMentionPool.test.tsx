// @vitest-environment jsdom
// The pool hook (BRIEF-94): a plain candidate array over the shared
// collaborators query — disabled/local path, non-ready, and ready all pinned,
// because every downstream boundary is optional and a dropped hand-off would
// otherwise regress to participants-only silently.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import { collaboratorsQueryOptions } from "../queries";
import { useMentionPool } from "./useMentionPool";

const apiFetchMock = vi.mocked(apiFetch);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

describe("useMentionPool", () => {
  it("is an empty pool with no descriptor (local path) and never fetches", () => {
    apiFetchMock.mockClear();
    const { result } = renderHook(() => useMentionPool(undefined), { wrapper });
    expect(result.current).toEqual([]);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("resolves to the roster candidates once the query is ready", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          collaborators: [{ login: "alice", name: "Alice Example" }],
          hasMore: false,
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(
      () => useMentionPool(collaboratorsQueryOptions("42")),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current).toEqual([
        { login: "alice", name: "Alice Example" },
      ]),
    );
  });

  it("is an empty pool on the unavailable result (viewerCanPush 404 etc.)", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    const { result } = renderHook(
      () => useMentionPool(collaboratorsQueryOptions("43")),
      { wrapper },
    );
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
