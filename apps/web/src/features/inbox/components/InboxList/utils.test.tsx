// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../i18n/I18nProvider";
import { listMatchingRows, readSelectionText } from "./utils";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function readRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function makeWireItem(prNumber: number) {
  return {
    repoId: "424242",
    repoSlug: "o/r",
    prNumber,
    title: `PR ${String(prNumber)}`,
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    viewerCanDelete: false,
    reviewState: "new",
    behind: false,
    unreachable: false,
    generation: null,
    latestBriefAt: null,
    githubUpdatedAt: null,
    stack: null,
  };
}

function makeWirePage(page: number, numbers: readonly number[], total: number) {
  return {
    items: numbers.map(makeWireItem),
    page,
    pageSize: 2,
    total,
    archivedTotal: 0,
    counts: { new: total, inProgress: 0, reviewed: 0, updated: 0 },
    viewer: { login: "octocat", avatarUrl: "https://a/1" },
    reachableInstallations: [],
    repositories: [{ repoId: "424242", repoSlug: "o/r" }],
    installUrl: null,
  };
}

function answerPages(pages: Record<string, unknown>): void {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(readRequestUrl(input), "http://x");
    const page = url.searchParams.get("page") ?? "1";
    const body = pages[page];
    return new Response(JSON.stringify(body ?? { error: "x" }), {
      status: body === undefined ? 500 : 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("listMatchingRows", () => {
  it("reads every page up to the cap, in order, each row once", async () => {
    answerPages({
      "1": makeWirePage(1, [1, 2], 5),
      "2": makeWirePage(2, [2, 3], 5),
      "3": makeWirePage(3, [4, 5], 5),
    });

    const rows = await listMatchingRows(makeClient(), {
      params: {},
      total: 5,
      pageSize: 2,
      cap: 200,
    });

    expect(rows.map((row) => row.prNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops at the cap and never reads the pages past it", async () => {
    answerPages({
      "1": makeWirePage(1, [1, 2], 5),
      "2": makeWirePage(2, [3, 4], 5),
    });

    const rows = await listMatchingRows(makeClient(), {
      params: {},
      total: 5,
      pageSize: 2,
      cap: 3,
    });

    expect(rows.map((row) => row.prNumber)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a page that fails or will not parse ends the read with the rows so far", async () => {
    answerPages({ "1": makeWirePage(1, [1, 2], 4) });

    const rows = await listMatchingRows(makeClient(), {
      params: {},
      total: 4,
      pageSize: 2,
      cap: 200,
    });

    expect(rows.map((row) => row.prNumber)).toEqual([1, 2]);
  });

  it("a page that will not parse ends the read too", async () => {
    answerPages({ "1": makeWirePage(1, [1, 2], 4), "2": { items: "no" } });

    const rows = await listMatchingRows(makeClient(), {
      params: {},
      total: 4,
      pageSize: 2,
      cap: 200,
    });

    expect(rows.map((row) => row.prNumber)).toEqual([1, 2]);
  });
});

describe("readSelectionText", () => {
  const t = appI18n.t;

  it("reads nothing, the count, the whole match, or the capped match", () => {
    const base = { selectedCount: 0, allMatching: false, total: 37, cap: 200 };
    expect(readSelectionText(t, base)).toBe("Nothing selected");
    expect(readSelectionText(t, { ...base, selectedCount: 1 })).toBe(
      "1 selected",
    );
    expect(readSelectionText(t, { ...base, allMatching: true })).toBe(
      "All 37 matching selected",
    );
    expect(
      readSelectionText(t, { ...base, allMatching: true, total: 201 }),
    ).toBe("The first 200 of 201 matching selected");
  });
});
