// @vitest-environment jsdom
// The pool hook: a plain candidate array over the shared collaborators query.
// Disabled/local path, non-ready and ready are all pinned; every downstream
// boundary is optional, so a dropped hand-off would silently regress to
// participants-only.
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
import { buildCollaboratorsQueryOptions } from "../queries";
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
  it("is an empty pool without a descriptor and never fetches", () => {
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
      () => useMentionPool(buildCollaboratorsQueryOptions("42")),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current).toEqual([
        { login: "alice", name: "Alice Example" },
      ]),
    );
  });

  it("is an empty pool on the unavailable result such as a 404", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    const { result } = renderHook(
      () => useMentionPool(buildCollaboratorsQueryOptions("43")),
      { wrapper },
    );
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
