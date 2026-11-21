// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../i18n/I18nProvider";
import { ArchiveScopes } from "./types";
import { ROW_LINK_ATTRIBUTE } from "./consts";
import {
  describeArchiveOutcome,
  focusCursorRow,
  listMatchingRows,
  NO_ROW,
  readRowIndex,
  readSelectionText,
} from "./utils";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

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
    viewerCanPush: false,
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

  it("a page that fails ends the read with the rows so far", async () => {
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

describe("describeArchiveOutcome", () => {
  const t = appI18n.t;
  const row = { scope: ArchiveScopes.ROW, total: 1, indeterminate: false };
  const selection = {
    scope: ArchiveScopes.SELECTION,
    total: 3,
    indeterminate: false,
  };

  it("a row reads its own line for either direction and outcome", () => {
    const archived = { ...row, restoring: false };
    const restored = { ...row, restoring: true };
    expect(describeArchiveOutcome(t, { ...archived, done: 1 })).toBe(
      "Archived; it comes back when a new brief lands",
    );
    expect(describeArchiveOutcome(t, { ...archived, done: 0 })).toBe(
      "Archive failed; the row is still here",
    );
    expect(describeArchiveOutcome(t, { ...restored, done: 1 })).toBe(
      "Back in your Inbox",
    );
    expect(describeArchiveOutcome(t, { ...restored, done: 0 })).toBe(
      "Unarchive failed; the row is still archived",
    );
  });

  it("a selection reads the count, or the tally when any failed", () => {
    const archived = { ...selection, restoring: false };
    const restored = { ...selection, restoring: true };
    expect(describeArchiveOutcome(t, { ...archived, done: 3 })).toBe(
      "Archived 3",
    );
    expect(describeArchiveOutcome(t, { ...archived, done: 1 })).toBe(
      "Archived 1 of 3; 2 failed",
    );
    expect(describeArchiveOutcome(t, { ...restored, done: 3 })).toBe(
      "Unarchived 3",
    );
    expect(describeArchiveOutcome(t, { ...restored, done: 0 })).toBe(
      "Unarchived 0 of 3; 3 failed",
    );
  });
});

/** A row holding a repository link before its link to the brief. */
function makeRow(): { row: HTMLLIElement; link: HTMLAnchorElement } {
  const row = document.createElement("li");
  const repoLink = document.createElement("a");
  const link = document.createElement("a");
  link.setAttribute(ROW_LINK_ATTRIBUTE, "");
  row.append(repoLink, link);
  return { row, link };
}

describe("focusCursorRow", () => {
  it("focuses the brief link without a scroll, then brings the row in", () => {
    const { row, link } = makeRow();
    document.body.append(row);
    const steps: string[] = [];
    const focus = vi.spyOn(link, "focus").mockImplementation(() => {
      steps.push("focus");
    });
    const scrollIntoView = vi.fn(() => {
      steps.push("scroll");
    });
    row.scrollIntoView = scrollIntoView;

    focusCursorRow(row);
    row.remove();

    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "nearest",
      behavior: "instant",
    });
    expect(steps).toEqual(["focus", "scroll"]);
  });
});

describe("readRowIndex", () => {
  it("counts the row holding the target through both lists", () => {
    const lists = document.createElement("div");
    const [aboveList, belowList] = [
      document.createElement("ol"),
      document.createElement("ol"),
    ];
    const rows = [makeRow(), makeRow(), makeRow()];
    aboveList.append(rows[0]!.row);
    belowList.append(rows[1]!.row, rows[2]!.row);
    lists.append(aboveList, belowList);

    expect(readRowIndex(lists, rows[2]!.link)).toBe(2);
    expect(readRowIndex(lists, lists)).toBe(NO_ROW);
    expect(readRowIndex(null, rows[0]!.link)).toBe(NO_ROW);
  });
});
