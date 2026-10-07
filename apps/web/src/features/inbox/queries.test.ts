// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { InboxSorts } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  archivePull,
  buildInboxQueryOptions,
  deleteOwnPull,
  deletePull,
  unarchivePull,
} from "./queries";
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
      viewerCanDelete: false,
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
  archivedTotal: 0,
  counts: { new: 1, inProgress: 0, reviewed: 0, updated: 0 },
  viewer: { login: "octocat", avatarUrl: "https://a/1" },
  reachableInstallations: [{ installationId: "10", accountLogin: "acme" }],
  repositories: [{ repoId: "424242", repoSlug: "o/r" }],
  installUrl: "https://github.com/apps/mergebrief/installations/new",
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
    if (state.kind !== InboxStates.READY) {
      return;
    }
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

  it("a refusal is the failed state carrying its wire code", async () => {
    answerWith(502, { code: "github-unavailable" });

    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.FAILED,
      code: "github-unavailable",
    });
  });

  it("a codeless 5xx is the server's failure, never GitHub's", async () => {
    fetchMock.mockResolvedValue(
      new Response("service unavailable", { status: 503 }),
    );
    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.FAILED,
      code: "internal-error",
    });

    answerWith(504, { error: "service unavailable" });
    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.FAILED,
      code: "internal-error",
    });
  });

  it("a failed answer is stale at once, so a focus re-reads it", async () => {
    answerWith(503, { code: "internal-error" });
    const options = buildInboxQueryOptions({});
    const staleTime = options.staleTime;
    if (typeof staleTime !== "function") {
      throw new Error("staleTime is fixed");
    }
    const query = { state: { data: await readInbox() } };

    expect(staleTime(query as never)).toBe(0);
  });
});

describe("deleteOwnPull", () => {
  it("DELETEs the inbox path and maps a 404 to not-found", async () => {
    answerWith(200, { ok: true });
    expect(await deleteOwnPull("424242", 7)).toEqual({ kind: "deleted" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/inbox\/424242\/7$/);
    expect(init?.method).toBe("DELETE");

    answerWith(404, { error: "x", code: "not-found" });
    expect(await deleteOwnPull("424242", 7)).toEqual({ kind: "not-found" });
  });
});

describe("deletePull", () => {
  it("calls the gated delete and reports the row gone", async () => {
    answerWith(200, { ok: true });

    const result = await deletePull("424242", 7);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/repos\/424242\/pulls\/7$/);
    expect(init?.method).toBe("DELETE");
    expect(result).toEqual({ kind: "deleted" });
  });

  it("a repo-admin-only refusal is the forbidden kind", async () => {
    answerWith(403, { error: "x", code: "repo-admin-only" });
    expect(await deletePull("424242", 7)).toEqual({ kind: "forbidden" });
  });

  it("a human-only refusal is the forbidden kind too", async () => {
    answerWith(403, { error: "x", code: "human-only" });
    expect(await deletePull("424242", 7)).toEqual({ kind: "forbidden" });
  });

  it("a 404 is the not-found kind", async () => {
    answerWith(404, { error: "x", code: "not-found" });
    expect(await deletePull("424242", 7)).toEqual({ kind: "not-found" });
  });

  it("a codeless 5xx is the failed kind", async () => {
    answerWith(502, {});
    expect(await deletePull("424242", 7)).toEqual({ kind: "failed" });
  });
});

describe("archivePull and unarchivePull", () => {
  it("archives through PUT on the row's archive path", async () => {
    answerWith(200, { ok: true });

    const result = await archivePull("424242", 7);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/repos\/424242\/pulls\/7\/archive$/);
    expect(init?.method).toBe("PUT");
    expect(result).toEqual({ kind: "archived" });
  });

  it("unarchives through DELETE on the same path", async () => {
    answerWith(200, { ok: true });

    const result = await unarchivePull("424242", 7);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/repos\/424242\/pulls\/7\/archive$/);
    expect(init?.method).toBe("DELETE");
    expect(result).toEqual({ kind: "unarchived" });
  });

  it("a 404 is not-found and anything else failed", async () => {
    answerWith(404, { error: "x", code: "not-found" });
    expect(await archivePull("424242", 7)).toEqual({ kind: "not-found" });
    answerWith(502, {});
    expect(await unarchivePull("424242", 7)).toEqual({ kind: "failed" });
  });
});
