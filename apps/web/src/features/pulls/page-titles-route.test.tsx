// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportSignedOut } from "@web/data/signed-out";
import { buildLocalBriefsQueryOptions } from "@web/features/brief/queries";
import { buildViewerQueryOptions } from "../account/queries";
import { ViewerStates, type ViewerState } from "../account/types";
import { buildInboxQueryOptions } from "../inbox/queries";
import { InboxStates, type InboxPage, type InboxState } from "../inbox/types";
import { routeTree } from "../../routeTree.gen";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const SIGNED_IN_VIEWER: ViewerState = {
  kind: ViewerStates.SIGNED_IN,
  login: "octocat",
  avatarUrl: "https://avatars.example/octocat.png",
  operator: false,
};
const READY_PAGE: InboxPage = {
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
  archivedTotal: 0,
  counts: { new: 0, inProgress: 0, reviewed: 0, updated: 0 },
  viewer: { login: "octocat", avatarUrl: "https://avatars.example/o.png" },
  reachableInstallations: [],
  repositories: [],
};
const READY_INBOX: InboxState = { kind: InboxStates.READY, page: READY_PAGE };
const VIEWER_KEY = buildViewerQueryOptions().queryKey;
const INBOX_KEY = buildInboxQueryOptions({}).queryKey;

async function loadSignedInApp(path = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(VIEWER_KEY, SIGNED_IN_VIEWER);
  queryClient.setQueryData(INBOX_KEY, READY_INBOX);
  queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, []);
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ items: [] })),
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

  return { router, queryClient };
}

/** Loads `path` with the inbox unread; each read is answered by `answer`. */
async function loadAppAnswering(
  answer: (url: string) => Response,
  path = "/",
  viewerCached = true,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (viewerCached) {
    queryClient.setQueryData(VIEWER_KEY, SIGNED_IN_VIEWER);
  }
  queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, []);
  answerReads(answer);

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

  return { router, queryClient };
}

function answerReads(answer: (url: string) => Response): void {
  fetchMock.mockImplementation((input) => {
    const url = readFetchUrl(input);
    return Promise.resolve(answer(url));
  });
}

function readFetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
}

/** The inbox meets `inbox`; every other read answers an empty list. */
function makeInboxAnswer(inbox: () => Response): (url: string) => Response {
  return (url) =>
    url.includes("/api/inbox") ? inbox() : Response.json({ items: [] });
}

/** GitHub refused the session's user token: the API's `unauthorized` 401. */
function makeTokenRefusedResponse(): Response {
  return Response.json(
    { error: "unauthorized", code: "unauthorized" },
    { status: 401 },
  );
}

function makeSignedOutResponse(): Response {
  return Response.json(
    { error: "signed-out", code: "signed-out" },
    { status: 401 },
  );
}

function makeServerFailureResponse(): Response {
  return Response.json(
    { error: "internal", code: "internal-error" },
    { status: 500 },
  );
}

function makeReadyInboxResponse(): Response {
  return Response.json(READY_PAGE);
}

/** Reads from here on stay unanswered, so only the test moves the cache. */
function stubPendingReads(): void {
  fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
}

/** Every read from here on meets the API's `signed-out` 401. */
function stubSessionEnded(): void {
  answerReads(makeSignedOutResponse);
}

describe("page tab titles", () => {
  it("follows a client navigation to settings", async () => {
    const { router } = await loadSignedInApp();

    await act(() => router.navigate({ to: "/settings" }));

    await waitFor(() => {
      expect(document.title).toBe("Settings · MergeBrief");
    });
  });

  it("titles a path no route matches Page not found", async () => {
    await loadSignedInApp("/no-such-page");

    await waitFor(() => {
      expect(document.title).toBe("Page not found · MergeBrief");
    });
  });

  it("titles Home Sign in when its own read finds the session gone", async () => {
    const { queryClient } = await loadSignedInApp();
    await waitFor(() => {
      expect(document.title).toBe("Briefs · MergeBrief");
    });

    stubSessionEnded();
    await act(() => queryClient.refetchQueries({ queryKey: INBOX_KEY }));

    await screen.findByRole("heading", { name: "Sign in" });
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });
  });

  it("titles Home Sign in when another read finds the session gone", async () => {
    await loadSignedInApp();

    stubSessionEnded();
    act(() => {
      reportSignedOut();
    });

    await screen.findByRole("heading", { name: "Sign in" });
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });
  });

  it("titles Home Briefs again once the viewer signs back in", async () => {
    const { queryClient } = await loadSignedInApp();
    stubSessionEnded();
    act(() => {
      reportSignedOut();
    });
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });

    stubPendingReads();
    act(() => {
      queryClient.setQueryData(VIEWER_KEY, SIGNED_IN_VIEWER);
      queryClient.setQueryData(INBOX_KEY, READY_INBOX);
    });

    await waitFor(() => {
      expect(document.title).toBe("Briefs · MergeBrief");
    });
  });

  it("titles Settings Sign in when the session ends there", async () => {
    await loadSignedInApp("/settings");
    await waitFor(() => {
      expect(document.title).toBe("Settings · MergeBrief");
    });

    stubSessionEnded();
    act(() => {
      reportSignedOut();
    });

    await screen.findByRole("heading", {
      name: "Sign in to manage API tokens",
    });
    await waitFor(() => {
      expect(document.title).toBe("Sign in to manage API tokens · MergeBrief");
    });
  });

  it("titles Settings again once the viewer signs back in", async () => {
    const { queryClient } = await loadSignedInApp("/settings");
    stubSessionEnded();
    act(() => {
      reportSignedOut();
    });
    await waitFor(() => {
      expect(document.title).toBe("Sign in to manage API tokens · MergeBrief");
    });

    stubPendingReads();
    act(() => {
      queryClient.setQueryData(VIEWER_KEY, SIGNED_IN_VIEWER);
    });

    await waitFor(() => {
      expect(document.title).toBe("Settings · MergeBrief");
    });
  });

  it("titles Home Sign in when GitHub refuses a live session", async () => {
    const { queryClient } = await loadAppAnswering(
      makeInboxAnswer(makeTokenRefusedResponse),
    );

    await screen.findByRole("heading", { name: "Sign in" });
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });
    expect(queryClient.getQueryData(VIEWER_KEY)).toEqual(SIGNED_IN_VIEWER);
  });

  it("retitles Home Sign in when a later read meets a refused token", async () => {
    const { queryClient } = await loadSignedInApp();
    await waitFor(() => {
      expect(document.title).toBe("Briefs · MergeBrief");
    });

    answerReads(makeInboxAnswer(makeTokenRefusedResponse));
    await act(() => queryClient.refetchQueries({ queryKey: INBOX_KEY }));

    await screen.findByRole("heading", { name: "Sign in" });
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });
  });

  it("retitles Home Briefs once a refused token reads again", async () => {
    const { queryClient } = await loadAppAnswering(
      makeInboxAnswer(makeTokenRefusedResponse),
    );
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });

    answerReads(makeInboxAnswer(makeReadyInboxResponse));
    await act(() => queryClient.refetchQueries({ queryKey: INBOX_KEY }));

    await waitFor(() => {
      expect(document.title).toBe("Briefs · MergeBrief");
    });
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("keeps Home titled Briefs when the inbox read fails", async () => {
    await loadAppAnswering(makeInboxAnswer(makeServerFailureResponse));

    await screen.findByRole("heading", { name: "Briefs could not be loaded" });
    await waitFor(() => {
      expect(document.title).toBe("Briefs · MergeBrief");
    });
  });

  it("titles a signed-out Home Sign in on its first load", async () => {
    await loadAppAnswering(makeSignedOutResponse, "/", false);

    await screen.findByRole("heading", { name: "Sign in" });
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });
  });

  it.each([
    { inbox: makeReadyInboxResponse, title: "Briefs · MergeBrief" },
    { inbox: makeTokenRefusedResponse, title: "Sign in · MergeBrief" },
  ])("titles Home $title when the viewer read fails", async (row) => {
    const answerInbox = makeInboxAnswer(row.inbox);
    await loadAppAnswering(
      (url) =>
        url.includes("/api/auth/session")
          ? makeServerFailureResponse()
          : answerInbox(url),
      "/",
      false,
    );

    await waitFor(() => {
      expect(document.title).toBe(row.title);
    });
  });

  it("keeps Settings titled when its viewer read fails", async () => {
    await loadAppAnswering(makeServerFailureResponse, "/settings", false);

    await screen.findByRole("heading", {
      name: "Settings could not be loaded",
    });
    await waitFor(() => {
      expect(document.title).toBe("Settings · MergeBrief");
    });
  });

  it("keeps Settings titled for a session GitHub refuses", async () => {
    const { router } = await loadAppAnswering(
      makeInboxAnswer(makeTokenRefusedResponse),
    );
    await waitFor(() => {
      expect(document.title).toBe("Sign in · MergeBrief");
    });

    await act(() => router.navigate({ to: "/settings" }));

    await screen.findByRole("heading", { name: "Settings", level: 1 });
    await waitFor(() => {
      expect(document.title).toBe("Settings · MergeBrief");
    });
  });
});
