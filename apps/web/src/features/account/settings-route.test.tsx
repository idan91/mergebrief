// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../routeTree.gen";
import { buildViewerQueryOptions } from "./queries";
import { ViewerStates, type ViewerState } from "./types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

async function loadSettings(
  viewer?: ViewerState,
  path = "/settings",
): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (viewer !== undefined) {
    queryClient.setQueryData(buildViewerQueryOptions().queryKey, viewer);
  }
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ code: "internal-error" }, { status: 500 })),
  );

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("the settings route", () => {
  it("points a signed-out viewer at sign-in under the page heading", async () => {
    await loadSettings({ kind: ViewerStates.SIGNED_OUT });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Settings",
      );
    });
    expect(
      screen.getByRole("link", { name: "Sign in with GitHub" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /API tokens/ })).toBeNull();
  });

  it("shows its tokens to a signed-in viewer", async () => {
    await loadSettings({
      kind: ViewerStates.SIGNED_IN,
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      operator: false,
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /API tokens/ })).toBeTruthy();
    });
    expect(
      screen.queryByRole("link", { name: "Sign in with GitHub" }),
    ).toBeNull();
  });

  it("leads the back link with an arrow", async () => {
    await loadSettings({ kind: ViewerStates.SIGNED_OUT });

    const back = await screen.findByRole("link", { name: "Back to briefs" });

    expect(back.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens the first tab when the asked-for tab is not shown", async () => {
    await loadSettings(
      {
        kind: ViewerStates.SIGNED_IN,
        login: "octocat",
        avatarUrl: "https://avatars.example/octocat.png",
        operator: false,
      },
      "/settings?tab=instance",
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /API tokens/ })).toBeTruthy();
    });
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("treats a viewer it could not confirm as signed out", async () => {
    await loadSettings({ kind: ViewerStates.UNKNOWN });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Sign in with GitHub" }),
      ).toBeTruthy();
    });
  });

  it("keeps the shell and offers a retry when the viewer read fails", async () => {
    await loadSettings();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Settings",
      );
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Settings could not be loaded",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to briefs" })).toBeTruthy();
  });
});
