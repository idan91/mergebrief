// @vitest-environment jsdom
// Where the band mounts: directly under the Header on Home, rendered through
// the real route tree, and directly under the Brief page's Header, pinned by
// the source order of the screen that composes it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildLocalBriefsQueryOptions } from "@web/features/brief/queries";
import { buildViewerQueryOptions } from "../account/queries";
import { ViewerStates, type ViewerState } from "../account/types";
import { buildInboxQueryOptions } from "../inbox/queries";
import { InboxStates, type InboxState } from "../inbox/types";
import { routeTree } from "../../routeTree.gen";
import { buildVersionQueryOptions } from "./queries";
import { VersionStates, type VersionState } from "./types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const VERSION: VersionState = {
  kind: VersionStates.KNOWN,
  snapshot: {
    version: "1.4.0",
    latest: "1.6.0",
    releaseNotesUrl: "https://example.test/releases/v1.6.0",
    checkedAt: "2026-10-03T10:00:00.000Z",
    breaking: false,
    security: false,
  },
};

async function loadHome(): Promise<void> {
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
      searchMatchTotal: 0,
      archivedSearchMatchTotal: 0,
      heldTotal: 0,
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
  queryClient.setQueryData(buildVersionQueryOptions().queryKey, VERSION);
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
}

describe("version notice mounts", () => {
  it("sits directly under the Header on Home", async () => {
    await loadHome();

    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: "New version notice" }),
      ).toBeTruthy();
    });
    const banner = screen.getByRole("banner");
    const band = screen.getByRole("status", { name: "New version notice" });
    expect(banner.nextElementSibling).toBe(band);
  });

  it("sits directly under the Header on the Brief page", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/features/brief/ui/components/BriefView/index.tsx",
      ),
      "utf8",
    );
    const header = source.indexOf("<Header");
    const headerEnd = source.indexOf("/>", header);
    const notice = source.indexOf(
      "<VersionNotice surface={NoticeSurfaces.BRIEF} />",
    );

    expect(header).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(headerEnd);
    expect(source.slice(headerEnd + 2, notice).trim()).toBe("");
  });
});
