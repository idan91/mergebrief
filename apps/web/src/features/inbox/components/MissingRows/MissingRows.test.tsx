// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InboxArchivedFilters } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EVERY_STATUS_PARAM,
  parseInboxSearch,
  readInboxChoices,
} from "../../search";
import {
  InboxEmptinesses,
  type InboxPage,
  type InboxSearchChange,
} from "../../types";
import { MissingRows } from ".";

afterEach(cleanup);

const EMPTY_PAGE: InboxPage = {
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
  archivedTotal: 0,
  searchMatchTotal: 0,
  archivedSearchMatchTotal: 0,
  counts: { new: 0, inProgress: 0, reviewed: 0, updated: 0 },
  viewer: { avatarUrl: "https://a/1" },
  reachableInstallations: [],
  repositories: [{ repoId: "1", repoSlug: "acme/web" }],
};

function mountMissingRows(
  raw: Record<string, unknown>,
  counts: Partial<InboxPage> = {},
) {
  const search = parseInboxSearch(raw);
  const mounted = {
    onWrite: vi.fn<(change: InboxSearchChange) => void>(),
    onClear: vi.fn<() => void>(),
    onSearchMissAction: vi.fn<() => void>(),
  };
  render(
    <MissingRows
      choices={readInboxChoices(search)}
      emptiness={InboxEmptinesses.FILTERED}
      page={{ ...EMPTY_PAGE, ...counts }}
      search={search}
      onClear={mounted.onClear}
      onSearchMissAction={mounted.onSearchMissAction}
      onWrite={mounted.onWrite}
    />,
  );
  return mounted;
}

describe("MissingRows", () => {
  it("without search text shows the filtered state and its Clear", () => {
    const mounted = mountMissingRows({ review: "new" });

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(mounted.onClear).toHaveBeenCalledTimes(1);
    expect(mounted.onSearchMissAction).not.toHaveBeenCalled();
  });

  it("a search the filters hide widens them and keeps the view", () => {
    const mounted = mountMissingRows(
      { q: "anchor", review: "new" },
      { searchMatchTotal: 2 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Show all matches" }));

    expect(mounted.onWrite).toHaveBeenCalledWith({
      state: EVERY_STATUS_PARAM,
      repo: undefined,
      review: undefined,
      author: undefined,
      installation: undefined,
      archived: undefined,
    });
    expect(mounted.onSearchMissAction).toHaveBeenCalledTimes(1);
  });

  it("matches only in the archive lead to the archived view", () => {
    const mounted = mountMissingRows(
      { q: "anchor" },
      { searchMatchTotal: 1, archivedSearchMatchTotal: 1 },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show archived matches" }),
    );

    expect(mounted.onWrite).toHaveBeenCalledWith(
      expect.objectContaining({ archived: InboxArchivedFilters.ONLY }),
    );
    expect(mounted.onSearchMissAction).toHaveBeenCalledTimes(1);
  });

  it("matches only outside the archive lead back to the Inbox", () => {
    const mounted = mountMissingRows(
      { q: "anchor", archived: "only" },
      { searchMatchTotal: 1 },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show matches outside the archive" }),
    );

    expect(mounted.onWrite).toHaveBeenCalledWith(
      expect.objectContaining({ archived: undefined }),
    );
  });

  it("a search with no match anywhere clears the search text alone", () => {
    const mounted = mountMissingRows({ q: "anchor", review: "new" });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(mounted.onWrite).toHaveBeenCalledWith({ q: undefined });
    expect(mounted.onSearchMissAction).toHaveBeenCalledTimes(1);
  });
});
