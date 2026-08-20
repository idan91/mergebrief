// @vitest-environment jsdom
// The session read through the real route: the loader reads it beside the
// Brief, so the FIRST paint is already marked — and when the read fails the
// Brief still renders, with writes off. Flat at the feature root for the same
// reason as its sibling route suites: a .test file under src/routes would
// trip route generation.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/utils/fixtures";
import { routeTree } from "../../routeTree.gen";
import type { ReviewSessionPayload } from "../review/session";
import { emptySessionPayload } from "../review/session";
import {
  dbBriefQueryOptions,
  prDiffQueryOptions,
  prMetaQueryOptions,
} from "./queries";
import type { PrSummary } from "./types";

// The client leg of `apiFetch` is `fetch` — stubbing it is what puts this
// suite on the real wire path, parser included.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const REPO_ID = "424242";
const PR_NUMBER = 7;
const SPAN = { base: "base-1", head: "head-1" };
const SESSION_PATH = `/api/repos/${REPO_ID}/pulls/${String(PR_NUMBER)}/session?base=${SPAN.base}&head=${SPAN.head}`;

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function meta(): PrSummary {
  return {
    repoId: REPO_ID,
    repoSlug: "octo/hello",
    prNumber: PR_NUMBER,
    title: "t",
    state: "open",
    baseSha: SPAN.base,
    headSha: SPAN.head,
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    generation: {
      status: "succeeded",
      phase: null,
      attempts: 0,
      errorCode: null,
      errorDetail: null,
      updatedAt: "2026-07-06T12:00:00.000Z",
    },
    updatedAt: "2026-07-06T12:00:00.000Z",
  };
}

/** The fixture's first chunk, read and carrying one draft comment. */
function workedSession(): ReviewSessionPayload {
  return {
    ...emptySessionPayload(),
    readMarks: ["chunk-a"],
    draftComments: [
      {
        id: "41",
        filePath: "src/leak.ts",
        side: "new",
        startLine: 10,
        endLine: 10,
        body: "the draft I already wrote",
        status: "draft",
      },
    ],
  };
}

/** The route with meta/brief/diff cached and the session left to the wire. */
async function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    prMetaQueryOptions(REPO_ID, PR_NUMBER).queryKey,
    meta(),
  );
  queryClient.setQueryData(
    dbBriefQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
    briefFixture,
  );
  queryClient.setQueryData(
    prDiffQueryOptions(REPO_ID, PR_NUMBER, SPAN.base, SPAN.head).queryKey,
    "",
  );
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({
      initialEntries: [
        `/repos/${REPO_ID}/pulls/${String(PR_NUMBER)}?base=${SPAN.base}&head=${SPAN.head}`,
      ],
    }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function viewedCheckboxes(): HTMLInputElement[] {
  return screen.getAllByRole<HTMLInputElement>("checkbox", { name: /viewed/i });
}

describe("the session read in the route loader", () => {
  it("keeps the Viewed toggles live when the session is there", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(emptySessionPayload()), { status: 200 }),
    );
    await renderRoute();
    expect(viewedCheckboxes().some((box) => box.disabled)).toBe(false);
  });

  it("first paint already carries the session — no unmarked flash", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(workedSession()), { status: 200 }),
    );
    await renderRoute();
    // Asserted with NO waiting: the loader resolved the read, so the very
    // first render shows the mark and the draft.
    expect(viewedCheckboxes()[0]?.checked).toBe(true);
    expect(screen.getByText("the draft I already wrote")).toBeTruthy();
  });

  it("reads the session with a GET and writes nothing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(emptySessionPayload()), { status: 200 }),
    );
    await renderRoute();
    const sessionCalls = fetchMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/session"),
    );
    expect(sessionCalls.length).toBeGreaterThan(0);
    expect(sessionCalls[0]?.[0]).toBe(SESSION_PATH);
    // No method = GET. A session is created by a WRITE, never by this read.
    for (const [, init] of sessionCalls) {
      expect(init?.method).toBeUndefined();
    }
  });

  it("degrades: a failed read renders the Brief with writes off", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await renderRoute();
    // The Brief is on screen…
    expect(screen.getByText(briefFixture.pr.title)).toBeTruthy();
    expect(viewedCheckboxes().length).toBeGreaterThan(0);
    // …and every write is off, not just the composer: a read mark or a
    // dismissal made blind is still a write against work the reviewer cannot
    // see. The Viewed toggles disable with the rest.
    expect(viewedCheckboxes().every((box) => box.disabled)).toBe(true);
    // And it SAYS so: a screen that silently refuses is worse than one that
    // explains. The chip rides the same posture as the controls.
    expect(screen.getAllByText("read-only").length).toBeGreaterThan(0);
    // The review flow states the reason instead of opening.
    fireEvent.click(await screen.findByRole("button", { name: /^submit$/i }));
    const advisory = screen.queryByRole("button", { name: /^continue$/i });
    if (advisory !== null) fireEvent.click(advisory);
    expect(
      (await screen.findAllByText(/review session couldn't be loaded/i)).length,
    ).toBeGreaterThan(0);
  });
});
