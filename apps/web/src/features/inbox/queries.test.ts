// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { InboxSorts } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInboxQueryOptions } from "./queries";
import { InboxStates } from "./types";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

const WIRE_PAGE = {
  items: [
    {
      repoId: "424242",
      repoSlug: "o/r",
      prNumber: 7,
      title: "Retry failed webhook deliveries",
      state: "open",
      draft: false,
      source: "installation",
      installationId: "10",
      viewerIsAuthor: false,
      reviewState: "new",
      behind: false,
      unreachable: false,
      generation: { status: "succeeded", updatedAt: "2026-09-20T10:00:00Z" },
      latestBriefAt: "2026-09-20T10:00:00Z",
      githubUpdatedAt: "2026-09-20T09:00:00Z",
      stack: { index: 2, size: 4 },
    },
  ],
  page: 1,
  pageSize: 25,
  total: 1,
  counts: { new: 1, inProgress: 0, reviewed: 0, updated: 0 },
  viewer: { login: "octocat", avatarUrl: "https://a/1" },
  reachableInstallations: [{ installationId: "10", accountLogin: "acme" }],
};

function answerWith(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function readInbox(params = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return client.fetchQuery(buildInboxQueryOptions(params));
}

describe("buildInboxQueryOptions", () => {
  it("reads and parses one page from the Inbox route", async () => {
    answerWith(200, WIRE_PAGE);

    const state = await readInbox({ sort: InboxSorts.GENERATED, page: 2 });

    expect(state.kind).toBe(InboxStates.READY);
    if (state.kind !== InboxStates.READY) return;
    expect(state.page.items[0]?.stack).toEqual({ index: 2, size: 4 });
    expect(state.page.counts.new).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(
      /\/api\/inbox\?page=2&sort=generated$/,
    );
  });

  it("a 401 is the signed-out state", async () => {
    answerWith(401, { code: "unauthorized" });

    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.SIGNED_OUT,
    });
  });

  it("a malformed page throws typed, never renders", async () => {
    answerWith(200, { ...WIRE_PAGE, counts: { new: "one" } });

    await expect(readInbox()).rejects.toMatchObject({ code: "malformed" });
  });

  it("an upstream failure throws with its wire code", async () => {
    answerWith(502, { code: "github-unavailable" });

    await expect(readInbox()).rejects.toMatchObject({
      code: "github-unavailable",
      status: 502,
    });
  });
});
