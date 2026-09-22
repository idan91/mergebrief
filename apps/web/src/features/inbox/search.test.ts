import { InboxQueryBounds } from "contract";
import { InboxAuthorFilters, InboxSorts, InboxStatuses } from "types/inbox";
import { describe, expect, it } from "vitest";

import {
  clearInboxFilters,
  countChangedFilters,
  EVERY_STATUS_PARAM,
  hasDefaultStatus,
  hasEveryStatus,
  listRepoOptions,
  parseInboxSearch,
  readInboxChoices,
  readInboxParams,
  readLastPage,
  toggleListValue,
  toggleStateValue,
  writeInboxSearch,
} from "./search";

describe("parseInboxSearch", () => {
  it("drops a page the wire would refuse and keeps a list to its cap", () => {
    const ids = Array.from({ length: 120 }, (_, index) => String(index + 1));

    expect(parseInboxSearch({ page: "99999999999" })).toEqual({});
    expect(
      parseInboxSearch({ page: String(InboxQueryBounds.MAX_PAGE) }),
    ).toEqual({
      page: InboxQueryBounds.MAX_PAGE,
    });
    expect(
      parseInboxSearch({ repo: ids.join(",") }).repo?.split(",").length,
    ).toBe(InboxQueryBounds.MAX_FILTER_VALUES);
  });

  it("keeps only the contract's vocabulary and drops every default", () => {
    expect(
      parseInboxSearch({
        page: "1",
        sort: "updated",
        state: "open,draft",
        author: "all",
        review: "new,bogus,new",
        repo: "424242,x",
        installation: "7001",
      }),
    ).toEqual({ review: "new", repo: "424242", installation: "7001" });
  });

  it("reads a page past one, another sort, a narrowed status and an author", () => {
    expect(
      parseInboxSearch({
        page: 3,
        sort: "generated",
        state: "merged,closed",
        author: "mine",
      }),
    ).toEqual({
      page: 3,
      sort: InboxSorts.GENERATED,
      state: "merged,closed",
      author: InboxAuthorFilters.MINE,
    });
  });

  it("a repeated-key address reads like the comma form", () => {
    const repeated = parseInboxSearch({
      state: ["open", "merged"],
      review: ["new", "updated"],
    });

    expect(repeated.state).toBe("open,merged");
    expect(repeated.review).toBe("new,updated");
  });

  it("a digits-only id the router decoded as a number reads as the id", () => {
    expect(parseInboxSearch({ repo: 424242 }).repo).toBe("424242");
    expect(parseInboxSearch({ repo: [1, 2] }).repo).toBe("1,2");
    expect(parseInboxSearch({ installation: 7001 }).installation).toBe("7001");
    expect(parseInboxSearch({ repo: 1.5 })).toEqual({});
    expect(parseInboxSearch({ repo: true })).toEqual({});
  });

  it("an empty or unknown search is the opening view", () => {
    expect(parseInboxSearch({})).toEqual({});
    expect(parseInboxSearch({ page: "zero", state: "", sort: 7 })).toEqual({});
  });
});

describe("readInboxParams and readInboxChoices", () => {
  it("expands the lists for the wire and fills the defaults for the controls", () => {
    const search = parseInboxSearch({ state: "merged", review: "new,updated" });

    expect(readInboxParams(search)).toEqual({
      state: ["merged"],
      review: ["new", "updated"],
    });
    expect(readInboxChoices(search)).toEqual({
      page: 1,
      sort: InboxSorts.UPDATED,
      states: ["merged"],
      repos: [],
      reviews: ["new", "updated"],
      author: InboxAuthorFilters.ALL,
      installations: [],
    });
  });
});

describe("hasEveryStatus", () => {
  it("is true only once every status the wire knows is ticked", () => {
    expect(hasEveryStatus(["open", "draft", "merged", "closed"])).toBe(true);
    expect(hasEveryStatus(["open", "draft"])).toBe(false);
    expect(EVERY_STATUS_PARAM).toBe("open,draft,merged,closed");
  });
});

describe("hasDefaultStatus", () => {
  it("is true while the address carries no status, whatever else it holds", () => {
    expect(hasDefaultStatus(parseInboxSearch({ review: "new" }))).toBe(true);
    expect(hasDefaultStatus(parseInboxSearch({ state: "open,draft" }))).toBe(
      true,
    );
    expect(hasDefaultStatus(parseInboxSearch({ state: "merged" }))).toBe(false);
  });
});

describe("writeInboxSearch", () => {
  it("a filter change starts over from page one", () => {
    const current = parseInboxSearch({ page: 4, review: "new" });

    expect(writeInboxSearch(current, { author: "mine" })).toEqual({
      review: "new",
      author: "mine",
    });
  });

  it("a sort change starts over from page one", () => {
    const current = parseInboxSearch({ page: 4, review: "new" });

    expect(writeInboxSearch(current, { sort: "generated" })).toEqual({
      review: "new",
      sort: "generated",
    });
  });

  it("a page change keeps every filter", () => {
    const current = parseInboxSearch({ review: "new", sort: "generated" });

    expect(writeInboxSearch(current, { page: 2 })).toEqual({
      page: 2,
      review: "new",
      sort: "generated",
    });
  });

  it("clear resets the filters and keeps the sort", () => {
    const current = parseInboxSearch({
      page: 2,
      review: "new",
      sort: "generated",
      author: "mine",
    });

    expect(clearInboxFilters(current)).toEqual({ sort: "generated" });
    expect(countChangedFilters(current)).toBe(2);
  });
});

describe("toggles", () => {
  it("a list value toggles and an empty list is the default", () => {
    expect(toggleListValue(["a"], "b")).toBe("a,b");
    expect(toggleListValue(["a", "b"], "a")).toBe("b");
    expect(toggleListValue(["a"], "a")).toBeUndefined();
  });

  it("the status filter never empties and the default set reads as unset", () => {
    expect(toggleStateValue([InboxStatuses.OPEN], InboxStatuses.OPEN)).toBe(
      "open",
    );
    expect(
      toggleStateValue([InboxStatuses.OPEN], InboxStatuses.DRAFT),
    ).toBeUndefined();
    expect(
      toggleStateValue(
        [InboxStatuses.OPEN, InboxStatuses.DRAFT],
        InboxStatuses.MERGED,
      ),
    ).toBe("open,draft,merged");
  });
});

describe("readLastPage and listRepoOptions", () => {
  it("rounds the total up to whole pages and never below one", () => {
    expect(readLastPage(0, 25)).toBe(1);
    expect(readLastPage(25, 25)).toBe(1);
    expect(readLastPage(26, 25)).toBe(2);
  });

  it("names each repository by slug, sorted, the id when it has none", () => {
    expect(
      listRepoOptions([
        { repoId: "2", repoSlug: "z/last" },
        { repoId: "1", repoSlug: "a/first" },
        { repoId: "3", repoSlug: null },
      ]),
    ).toEqual([
      { value: "3", label: "3" },
      { value: "1", label: "a/first" },
      { value: "2", label: "z/last" },
    ]);
  });
});
