// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as RouterModule from "@tanstack/react-router";

import { ApiError, ApiErrorCodes } from "../../../data/apiFetch";
import { buildViewerQueryOptions } from "../queries";
import { ViewerStates, type ViewerState } from "../types";
import { useReloadOnViewerChange } from "./useReloadOnViewerChange";

const invalidate = vi.fn(() => Promise.resolve());
const routerState: { status: string; matches: { error?: unknown }[] } = {
  status: "idle",
  matches: [],
};
const resolvedListeners = new Set<() => void>();

function subscribeResolved(_event: string, listener: () => void): () => void {
  resolvedListeners.add(listener);
  return () => {
    resolvedListeners.delete(listener);
  };
}

function settleLoad(matches: { error?: unknown }[]): void {
  routerState.status = "idle";
  routerState.matches = matches;
  for (const listener of resolvedListeners) {
    listener();
  }
}

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({
    invalidate,
    state: routerState,
    subscribe: subscribeResolved,
  }),
}));

const SIGNED_OUT_REFUSAL = new ApiError(
  ApiErrorCodes.SIGNED_OUT,
  401,
  "/api/repos/1/pulls/7",
);

const VIEWER_KEY = buildViewerQueryOptions().queryKey;
const SIGNED_IN_VIEWER: ViewerState = {
  kind: ViewerStates.SIGNED_IN,
  login: "octocat",
  avatarUrl: "https://avatars.example.test/u/1",
  operator: false,
};

afterEach(() => {
  cleanup();
  invalidate.mockClear();
  routerState.status = "idle";
  routerState.matches = [];
  resolvedListeners.clear();
});

function mountWithViewer(viewer?: ViewerState): QueryClient {
  const client = new QueryClient();
  if (viewer !== undefined) {
    client.setQueryData(VIEWER_KEY, viewer);
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  renderHook(
    () => {
      useReloadOnViewerChange();
    },
    { wrapper: Wrapper },
  );
  return client;
}

describe("useReloadOnViewerChange", () => {
  it("reloads once when the viewer signs out and once when back", async () => {
    const client = mountWithViewer(SIGNED_IN_VIEWER);

    act(() => {
      client.setQueryData(VIEWER_KEY, { kind: ViewerStates.SIGNED_OUT });
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    await act(async () => {
      client.setQueryData(VIEWER_KEY, { kind: ViewerStates.SIGNED_OUT });
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(1);

    act(() => {
      client.setQueryData(VIEWER_KEY, SIGNED_IN_VIEWER);
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
  });

  it("leaves the router alone on mount and on a first signed-in read", async () => {
    const client = mountWithViewer();

    await act(async () => {
      client.setQueryData(VIEWER_KEY, SIGNED_IN_VIEWER);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("waits out a load in flight, then reloads", async () => {
    const client = mountWithViewer(SIGNED_IN_VIEWER);
    routerState.status = "pending";

    act(() => {
      client.setQueryData(VIEWER_KEY, { kind: ViewerStates.SIGNED_OUT });
    });
    await waitFor(() => expect(resolvedListeners.size).toBe(1));
    expect(invalidate).not.toHaveBeenCalled();

    settleLoad([{}]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(resolvedListeners.size).toBe(0);
  });

  it("skips the reload when the settled load refused the sign-out", async () => {
    const client = mountWithViewer(SIGNED_IN_VIEWER);
    routerState.status = "pending";

    act(() => {
      client.setQueryData(VIEWER_KEY, { kind: ViewerStates.SIGNED_OUT });
    });
    await waitFor(() => expect(resolvedListeners.size).toBe(1));
    settleLoad([{}, { error: SIGNED_OUT_REFUSAL }]);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("skips the reload when the screen already shows that refusal", async () => {
    routerState.matches = [{ error: SIGNED_OUT_REFUSAL }];
    const client = mountWithViewer(SIGNED_IN_VIEWER);

    await act(async () => {
      client.setQueryData(VIEWER_KEY, { kind: ViewerStates.SIGNED_OUT });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("never fetches the viewer itself", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    mountWithViewer();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
