import { InboxQueryBounds } from "contract";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxSorts,
  InboxStatuses,
} from "types/inbox";
import { describe, expect, it } from "vitest";

import {
  clearInboxFilters,
  countChangedFilters,
  dropPendingSearchText,
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
  widenInboxFilters,
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

  it("reads the archived view and drops its default", () => {
    expect(parseInboxSearch({ archived: "only" })).toEqual({
      archived: InboxArchivedFilters.ONLY,
    });
    expect(parseInboxSearch({ archived: "hide" })).toEqual({});
    expect(parseInboxSearch({ archived: "bogus" })).toEqual({});
    expect(readInboxParams({ archived: InboxArchivedFilters.ONLY })).toEqual({
      archived: InboxArchivedFilters.ONLY,
    });
    expect(countChangedFilters({ archived: InboxArchivedFilters.ONLY })).toBe(
      1,
    );
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
      layout: "folded",
      states: ["merged"],
      repos: [],
      reviews: ["new", "updated"],
      author: InboxAuthorFilters.ALL,
      installations: [],
      archived: InboxArchivedFilters.HIDE,
      searchText: "",
    });
  });
});

describe("the layout", () => {
  it("rides the URL off its default, never the wire, and survives a clear", () => {
    expect(parseInboxSearch({ layout: "folded" })).toEqual({});
    const mixed = parseInboxSearch({ layout: "mixed", repo: "424242" });
    expect(mixed.layout).toBe("mixed");
    expect(readInboxChoices(mixed).layout).toBe("mixed");
    expect(readInboxParams(mixed).layout).toBe("mixed");
    expect(clearInboxFilters(mixed)).toEqual({ layout: "mixed" });
    expect(parseInboxSearch({ layout: "sideways" })).toEqual({});
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
        { repoId: "3" },
      ]),
    ).toEqual([
      { value: "3", label: "3" },
      { value: "1", label: "a/first" },
      { value: "2", label: "z/last" },
    ]);
  });
});

describe("the search text", () => {
  it("reads the text trimmed and drops a blank one", () => {
    expect(parseInboxSearch({ q: "  anchor ids " })).toEqual({
      q: "anchor ids",
    });
    expect(parseInboxSearch({ q: "   " })).toEqual({});
  });

  it("cuts text past the bound by whole characters", () => {
    const filler = "a".repeat(InboxQueryBounds.MAX_SEARCH_TEXT_LENGTH - 1);

    const parsed = parseInboxSearch({ q: `${filler}\u{1F680}zzz` });

    expect(parsed.q).toBe(`${filler}\u{1F680}`);
  });

  it("keeps digits as the number the router prints back bare", () => {
    expect(parseInboxSearch({ q: 1412 })).toEqual({ q: 1412 });
    expect(parseInboxSearch({ q: "1412" })).toEqual({ q: 1412 });
    expect(parseInboxSearch({ q: "0141" })).toEqual({ q: "0141" });
    expect(readInboxParams({ q: 1412 }).q).toBe("1412");
  });

  it("reads a value the router decoded as something else as its text", () => {
    expect(parseInboxSearch({ q: true })).toEqual({ q: "true" });
    expect(parseInboxSearch({ q: null })).toEqual({ q: "null" });
    expect(parseInboxSearch({ q: { nested: 1 } })).toEqual({});
  });

  it("goes to the wire and fills the controls with an empty default", () => {
    expect(readInboxParams({ q: "anchor" })).toEqual({ q: "anchor" });
    expect(readInboxChoices({ q: "anchor" }).searchText).toBe("anchor");
    expect(readInboxChoices({}).searchText).toBe("");
  });

  it("counts as a changed filter, restarts the pages and clears", () => {
    const searched = writeInboxSearch({ page: 4 }, { q: "anchor" });

    expect(searched).toEqual({ q: "anchor" });
    expect(countChangedFilters(searched)).toBe(1);
    expect(
      clearInboxFilters({ ...searched, sort: InboxSorts.GENERATED }),
    ).toEqual({ sort: InboxSorts.GENERATED });
  });

  it("an emptied field removes the key", () => {
    expect(writeInboxSearch({ q: "anchor" }, { q: "" })).toEqual({});
  });
});

describe("dropPendingSearchText", () => {
  it("goes back to the list on screen when only the search was loading", () => {
    const shown = parseInboxSearch({ page: 3, review: "new", q: "fo" });
    const loading = parseInboxSearch({ review: "new", q: "foo" });

    expect(dropPendingSearchText(loading, shown)).toEqual(shown);
  });

  it("keeps a filter change that was loading too", () => {
    const shown = parseInboxSearch({ page: 3, review: "new" });
    const loading = parseInboxSearch({
      review: "new",
      author: "mine",
      q: "fo",
    });

    expect(dropPendingSearchText(loading, shown)).toEqual({
      review: "new",
      author: "mine",
    });
  });
});

describe("widenInboxFilters", () => {
  const narrowed = parseInboxSearch({
    page: 2,
    sort: "generated",
    state: "merged",
    repo: "424242",
    review: "new",
    author: "mine",
    installation: "7001",
    q: "anchor",
  });

  it("opens every filter and keeps the search text and the sort", () => {
    const widened = writeInboxSearch(
      narrowed,
      widenInboxFilters(InboxArchivedFilters.HIDE),
    );

    expect(widened).toEqual({
      sort: "generated",
      state: EVERY_STATUS_PARAM,
      q: "anchor",
    });
  });

  it("moves to the archived view when asked for it", () => {
    const widened = writeInboxSearch(
      narrowed,
      widenInboxFilters(InboxArchivedFilters.ONLY),
    );

    expect(widened).toEqual({
      sort: "generated",
      state: EVERY_STATUS_PARAM,
      archived: InboxArchivedFilters.ONLY,
      q: "anchor",
    });
  });

  it("leaves the archived view for the Inbox when asked for that", () => {
    const archived = { ...narrowed, archived: InboxArchivedFilters.ONLY };

    const widened = writeInboxSearch(
      archived,
      widenInboxFilters(InboxArchivedFilters.HIDE),
    );

    expect(widened.archived).toBeUndefined();
    expect(widened.q).toBe("anchor");
  });
});
