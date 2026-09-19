// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildLocalBriefsQueryOptions } from "@web/features/brief/queries";
import { buildInstallationsQueryOptions } from "@web/features/installations/queries";
import { routeTree } from "../../routeTree.gen";
import {
  buildPullsSessionQueryOptions,
  buildUrlBriefsQueryOptions,
} from "./queries";
import type { PullsSession } from "./types";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

async function loadHome() {
  const session: PullsSession = { kind: "ready", pulls: [] };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(buildPullsSessionQueryOptions().queryKey, session);
  queryClient.setQueryData(buildUrlBriefsQueryOptions().queryKey, session);
  queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, []);
  queryClient.setQueryData(buildInstallationsQueryOptions().queryKey, {
    installations: [
      {
        installationId: "111",
        accountLogin: "acme",
        isCurrent: true,
        isDefault: true,
      },
    ],
    currentInstallationId: "111",
    defaultInstallationId: "111",
  });
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ pulls: [] })),
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
