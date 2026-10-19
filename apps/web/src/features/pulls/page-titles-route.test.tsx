// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildLocalBriefsQueryOptions } from "@web/features/brief/queries";
import { buildViewerQueryOptions } from "../account/queries";
import { ViewerStates, type ViewerState } from "../account/types";
import { buildInboxQueryOptions } from "../inbox/queries";
import { InboxStates, type InboxState } from "../inbox/types";
import { routeTree } from "../../routeTree.gen";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

async function loadHome() {
  const viewer: ViewerState = {
    kind: ViewerStates.SIGNED_IN,
    login: "octocat",
    avatarUrl: "https://avatars.example/octocat.png",
    operator: false,
  };
  const inbox: InboxState = {
    kind: InboxStates.READY,
    page: {
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
      archivedTotal: 0,
      counts: { new: 0, inProgress: 0, reviewed: 0, updated: 0 },
      viewer: { login: "octocat", avatarUrl: "https://avatars.example/o.png" },
      reachableInstallations: [],
      repositories: [],
    },
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(buildViewerQueryOptions().queryKey, viewer);
  queryClient.setQueryData(buildInboxQueryOptions({}).queryKey, inbox);
  queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, []);
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ items: [] })),
  );

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
}

describe("page tab titles", () => {
  it("names the home page", async () => {
    await loadHome();

    await waitFor(() => {
      expect(document.title).toBe("Briefs · MergeBrief");
    });
  });

  it("follows a client navigation to settings", async () => {
    const router = await loadHome();

    await act(() => router.navigate({ to: "/settings" }));

    await waitFor(() => {
      expect(document.title).toBe("Settings · MergeBrief");
    });
  });
});
