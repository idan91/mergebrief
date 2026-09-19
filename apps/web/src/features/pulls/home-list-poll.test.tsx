// @vitest-environment jsdom
// The home lists through the real route: they refetch on an interval only
// while a row can still change its status word. Flat at the feature root like
// the sibling route suites: a .test file under src/routes would trip route
// generation. The seeded cache bypasses the wire parsers, which
// queries.test.ts covers against real bodies.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildLocalBriefsQueryOptions } from "@web/features/brief/queries";
import { buildInstallationsQueryOptions } from "@web/features/installations/queries";
import { routeTree } from "../../routeTree.gen";
import {
  buildPullsSessionQueryOptions,
  buildUrlBriefsQueryOptions,
} from "./queries";
import {
  GenerationStatuses,
  type GenerationStatus,
  type PrSummary,
  type PullsSession,
} from "./types";

const LIST_PATHS = ["/api/pulls", "/api/briefs"];
const ONE_POLL_MS = 10_000;
const THREE_POLLS_MS = 30_000;

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  fetchMock.mockReset();
});

function makeRow(status: GenerationStatus): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    baseSha: "base-1",
    headSha: "head-1",
    briefAvailable: false,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    generation: {
      status,
      phase: null,
      attempts: 0,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
    updatedAt: "2026-07-06T12:00:00.000Z",
  };
}

function getRequestPath(input: Parameters<typeof fetch>[0]): string {
  const raw = input instanceof Request ? input.url : String(input);
  return new URL(raw, "http://localhost").pathname;
}

function countListFetches(): number {
  return fetchMock.mock.calls.filter(([input]) =>
    LIST_PATHS.includes(getRequestPath(input)),
  ).length;
}

async function renderHome(status: GenerationStatus) {
  const session: PullsSession = { kind: "ready", pulls: [makeRow(status)] };
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
  // Whatever the load and the mount fetched is not the interval's: only
  // fetches after this line count.
  fetchMock.mockClear();
}

describe("home list poll", () => {
  it("refetches both lists once per interval while a row is pending", async () => {
    await renderHome(GenerationStatuses.PENDING);

    await act(() => vi.advanceTimersByTimeAsync(ONE_POLL_MS));

    expect(countListFetches()).toBe(LIST_PATHS.length);
  });

  it("never refetches when every row is terminal", async () => {
    await renderHome(GenerationStatuses.SUCCEEDED);

    await act(() => vi.advanceTimersByTimeAsync(THREE_POLLS_MS));

    expect(countListFetches()).toBe(0);
  });
});
