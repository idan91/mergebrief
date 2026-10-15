// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { reportSignedOut } from "../../../data/signed-out";
import { buildViewerQueryOptions } from "../queries";
import { ViewerStates, type ViewerState } from "../types";
import { useSyncViewerOnSignOut } from "./useSyncViewerOnSignOut";

const SIGNED_IN_VIEWER: ViewerState = {
  kind: ViewerStates.SIGNED_IN,
  login: "octocat",
  avatarUrl: "https://avatars.example.test/u/1",
};
const VIEWER_KEY = buildViewerQueryOptions().queryKey;
const BRIEF_KEY = ["brief", "42"];

function buildWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function mountWithSignedInViewer() {
  const client = new QueryClient();
  client.setQueryData(VIEWER_KEY, SIGNED_IN_VIEWER);
  const { unmount } = renderHook(
    () => {
      useSyncViewerOnSignOut();
    },
    { wrapper: buildWrapper(client) },
  );
  return { client, unmount };
}

describe("useSyncViewerOnSignOut", () => {
  it("moves the viewer to signed out on a signed-out report", () => {
    const { client } = mountWithSignedInViewer();

    act(() => {
      reportSignedOut();
    });

    expect(client.getQueryData(VIEWER_KEY)).toEqual({
      kind: ViewerStates.SIGNED_OUT,
    });
  });

  it("leaves the viewer stale so the next focus reads it again", () => {
    const { client } = mountWithSignedInViewer();

    act(() => {
      reportSignedOut();
    });

    expect(client.getQueryState(VIEWER_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(VIEWER_KEY)?.fetchStatus).toBe("idle");
  });

  it("clears every other read the signed-in viewer loaded", () => {
    const { client } = mountWithSignedInViewer();
    client.setQueryData(BRIEF_KEY, { title: "Add widgets" });

    act(() => {
      reportSignedOut();
    });

    expect(client.getQueryData(BRIEF_KEY)).toBeUndefined();
  });

  it("leaves the cache alone once the viewer is already signed out", () => {
    const { client } = mountWithSignedInViewer();
    act(() => {
      reportSignedOut();
    });
    client.setQueryData(BRIEF_KEY, { title: "Add widgets" });

    act(() => {
      reportSignedOut();
    });

    expect(client.getQueryData(BRIEF_KEY)).toEqual({ title: "Add widgets" });
  });

  it("lets a read in flight fail with its own refusal", async () => {
    const { client } = mountWithSignedInViewer();
    const refusal = new Error("signed-out");

    const loading = client.ensureQueryData({
      queryKey: BRIEF_KEY,
      queryFn: async () => {
        reportSignedOut();
        throw refusal;
      },
      retry: false,
    });

    await expect(loading).rejects.toBe(refusal);
  });

  it("clears the reporting read's old data once it settles", async () => {
    const { client } = mountWithSignedInViewer();
    client.setQueryData(BRIEF_KEY, { title: "Add widgets" });
    const refusal = new Error("signed-out");

    const refetching = client.fetchQuery({
      queryKey: BRIEF_KEY,
      queryFn: async () => {
        reportSignedOut();
        throw refusal;
      },
      retry: false,
      staleTime: 0,
    });

    await expect(refetching).rejects.toBe(refusal);
    expect(client.getQueryData(BRIEF_KEY)).toBeUndefined();
  });

  it("stops listening once unmounted", () => {
    const { client, unmount } = mountWithSignedInViewer();

    unmount();
    reportSignedOut();

    expect(client.getQueryData(VIEWER_KEY)).toEqual(SIGNED_IN_VIEWER);
  });
});
