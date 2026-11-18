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
  it("gives a signed-out viewer the sign-in page, returning here", async () => {
    await loadSettings({ kind: ViewerStates.SIGNED_OUT });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Sign in to manage API tokens",
      );
    });
    expect(
      screen
        .getByRole("link", { name: "Sign in with GitHub" })
        .getAttribute("href"),
    ).toBe("/api/auth/github?returnTo=%2Fsettings");
    expect(screen.queryByRole("heading", { name: "API tokens" })).toBeNull();
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
    expect(screen.queryByRole("heading", { name: "Daily runs" })).toBeNull();
  });

  it("shows the API tokens heading when no rail names the section", async () => {
    await loadSettings({
      kind: ViewerStates.SIGNED_IN,
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      operator: false,
    });

    const heading = await screen.findByRole("heading", { name: "API tokens" });

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(heading.classList.contains("sr-only")).toBe(false);
  });

  it("keeps the API tokens heading for assistive tech under the rail", async () => {
    await loadSettings(
      {
        kind: ViewerStates.SIGNED_IN,
        login: "octocat",
        avatarUrl: "https://avatars.example/octocat.png",
        operator: true,
      },
      "/settings?tab=tokens",
    );

    const heading = await screen.findByRole("heading", { name: "API tokens" });

    expect(screen.getByRole("tab", { name: "API tokens" })).toBeTruthy();
    expect(heading.classList.contains("sr-only")).toBe(true);
  });

  it("puts an Operator's Instance tab on the rail", async () => {
    await loadSettings(
      {
        kind: ViewerStates.SIGNED_IN,
        login: "octocat",
        avatarUrl: "https://avatars.example/octocat.png",
        operator: true,
      },
      "/settings?tab=instance",
    );

    const instance = await screen.findByRole("tab", { name: "Instance" });

    expect(instance.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "API tokens" })).toBeTruthy();
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
    expect(screen.getByRole("link", { name: "MergeBrief" })).toBeTruthy();
  });

  it("keeps the Settings tab title when the viewer read fails", async () => {
    await loadSettings();

    await waitFor(() => {
      expect(document.title).toBe("Settings · MergeBrief");
    });
  });

  it("returns a signed-out viewer to the tab they asked for", async () => {
    await loadSettings(
      { kind: ViewerStates.SIGNED_OUT },
      "/settings?tab=instance",
    );

    const signIn = await screen.findByRole("link", {
      name: "Sign in with GitHub",
    });

    const returnTo = new URL(
      signIn.getAttribute("href") ?? "",
      "http://localhost",
    ).searchParams.get("returnTo");
    expect(returnTo).toBe("/settings?tab=instance");
  });
});
