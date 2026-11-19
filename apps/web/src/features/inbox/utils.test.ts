import {
  InboxReviewStates,
  InboxSortDirections,
  InboxSorts,
  InboxArchivedFilters,
} from "types/inbox";
import { describe, expect, it } from "vitest";

import { ApiError, ApiErrorCodes } from "../../data/apiFetch";
import { omitFields } from "@web/test/fields";
import {
  buildInboxSearch,
  formatAge,
  runWithConcurrency,
  needsReviewer,
  pickAgeAt,
  splitAtFold,
  splitTitleCode,
  readFailedReadCode,
  readInboxEmptiness,
  readSearchMissReason,
} from "./utils";
import { InboxEmptinesses, SearchMissKinds, type InboxItem } from "./types";

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoId: "1",
    repoSlug: "o/r",
    prNumber: 1,
    title: "t",
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    viewerCanDelete: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    latestBriefAt: "2026-09-19T10:00:00Z",
    githubUpdatedAt: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

describe("buildInboxSearch", () => {
  it("answers an empty string for the defaults", () => {
    expect(buildInboxSearch({})).toBe("");
  });

  it("repeats a multi-valued key and keeps the wire order", () => {
    expect(
      buildInboxSearch({
        page: 3,
        sort: InboxSorts.GENERATED,
        state: ["open", "draft"],
        review: [InboxReviewStates.UPDATED],
      }),
    ).toBe("?page=3&sort=generated&state=open&state=draft&review=updated");
  });

  it("sends the direction beside the sort", () => {
    const search = buildInboxSearch({
      sort: InboxSorts.CREATED,
      direction: InboxSortDirections.ASCENDING,
    });

    expect(search).toBe("?sort=created&direction=asc");
  });

  it("sends the search text as q", () => {
    expect(buildInboxSearch({ q: "anchor #141" })).toBe("?q=anchor+%23141");
  });

  it("leaves page 1 and an empty list out", () => {
    expect(buildInboxSearch({ page: 1, repo: [] })).toBe("");
  });
});

describe("splitAtFold", () => {
  it("puts new, updated and in-progress rows above the fold in order", () => {
    const above = [
      makeItem({ prNumber: 1, reviewState: InboxReviewStates.UPDATED }),
      makeItem({ prNumber: 2, reviewState: InboxReviewStates.IN_PROGRESS }),
      makeItem({ prNumber: 3, reviewState: InboxReviewStates.NEW }),
    ];
    const below = [
      makeItem({ prNumber: 4, reviewState: InboxReviewStates.REVIEWED }),
      omitFields(
        makeItem({ prNumber: 5, viewerIsAuthor: true }),
        "reviewState",
      ),
    ];

    const split = splitAtFold([below[0]!, ...above, below[1]!]);

    expect(split.above.map((item) => item.prNumber)).toEqual([1, 2, 3]);
    expect(split.below.map((item) => item.prNumber)).toEqual([4, 5]);
  });

  it("needsReviewer is true for every row above the fold", () => {
    expect(needsReviewer(makeItem())).toBe(true);
    expect(
      needsReviewer(makeItem({ reviewState: InboxReviewStates.UPDATED })),
    ).toBe(true);
    expect(
      needsReviewer(makeItem({ reviewState: InboxReviewStates.IN_PROGRESS })),
    ).toBe(true);
    expect(
      needsReviewer(makeItem({ reviewState: InboxReviewStates.REVIEWED })),
    ).toBe(false);
    expect(needsReviewer(omitFields(makeItem(), "reviewState"))).toBe(false);
  });

  it("a draft or a merged row sits below the fold whatever its state", () => {
    expect(needsReviewer(makeItem({ draft: true }))).toBe(false);
    expect(needsReviewer(makeItem({ state: "merged" }))).toBe(false);
    expect(needsReviewer(makeItem({ state: "closed" }))).toBe(false);
  });
});

describe("pickAgeAt", () => {
  it("reads the sort's timestamp and falls back to the other", () => {
    const item = makeItem();
    expect(pickAgeAt(item, InboxSorts.UPDATED)).toBe("2026-09-20T10:00:00Z");
    expect(pickAgeAt(item, InboxSorts.GENERATED)).toBe("2026-09-19T10:00:00Z");
    expect(
      pickAgeAt(omitFields(makeItem(), "latestBriefAt"), InboxSorts.GENERATED),
    ).toBe("2026-09-20T10:00:00Z");
    expect(
      pickAgeAt(
        omitFields(makeItem(), "latestBriefAt", "githubUpdatedAt"),
        InboxSorts.UPDATED,
      ),
    ).toBeUndefined();
  });
});

describe("pickAgeAt under the created sort", () => {
  it("reads the creation time, else the update time", () => {
    const created = makeItem({ githubCreatedAt: "2026-09-01T08:00:00Z" });

    expect(pickAgeAt(created, InboxSorts.CREATED)).toBe("2026-09-01T08:00:00Z");
    expect(pickAgeAt(makeItem(), InboxSorts.CREATED)).toBe(
      "2026-09-20T10:00:00Z",
    );
  });
});

describe("formatAge", () => {
  const now = new Date("2026-09-20T12:00:00Z");

  it("older than two weeks is a date", () => {
    expect(formatAge("2026-08-01T12:00:00Z", now)).toEqual({
      unit: "date",
      count: 50,
    });
  });

  it("a future or unparsable stamp reads as now", () => {
    expect(formatAge("2027-01-01T00:00:00Z", now)).toEqual({
      unit: "minutes",
      count: 0,
    });
    expect(formatAge("nope", now)).toEqual({ unit: "minutes", count: 0 });
  });
});

describe("splitTitleCode", () => {
  it("turns backtick spans into code segments", () => {
    expect(splitTitleCode("Rename `balance_minor` to `units` now")).toEqual([
      { kind: "text", text: "Rename " },
      { kind: "code", text: "balance_minor" },
      { kind: "text", text: " to " },
      { kind: "code", text: "units" },
      { kind: "text", text: " now" },
    ]);
  });

  it("leaves an unpaired backtick as text", () => {
    expect(splitTitleCode("odd ` tick")).toEqual([
      { kind: "text", text: "odd ` tick" },
    ]);
  });
});

describe("readInboxEmptiness", () => {
  const HIDE = InboxArchivedFilters.HIDE;

  it("tells no rows at all from filtered and from hidden by default", () => {
    const repositories = [{ repoId: "1", repoSlug: "a/b" }];

    expect(
      readInboxEmptiness({ total: 3, repositories, archivedTotal: 0 }, 0, HIDE),
    ).toBe(InboxEmptinesses.ROWS);
    expect(
      readInboxEmptiness(
        { total: 0, repositories: [], archivedTotal: 0 },
        0,
        HIDE,
      ),
    ).toBe(InboxEmptinesses.EMPTY);
    expect(
      readInboxEmptiness({ total: 0, repositories, archivedTotal: 0 }, 2, HIDE),
    ).toBe(InboxEmptinesses.FILTERED);
    expect(
      readInboxEmptiness({ total: 0, repositories, archivedTotal: 0 }, 0, HIDE),
    ).toBe(InboxEmptinesses.HIDDEN_BY_DEFAULT);
  });

  it("names a fully archived inbox whatever the filters, never an empty one", () => {
    const repositories = [{ repoId: "1", repoSlug: "a/b" }];

    expect(
      readInboxEmptiness(
        { total: 0, repositories: [], archivedTotal: 2 },
        0,
        HIDE,
      ),
    ).toBe(InboxEmptinesses.ALL_ARCHIVED);
    expect(
      readInboxEmptiness(
        { total: 0, repositories: [], archivedTotal: 2 },
        1,
        HIDE,
      ),
    ).toBe(InboxEmptinesses.ALL_ARCHIVED);
    expect(
      readInboxEmptiness({ total: 0, repositories, archivedTotal: 2 }, 0, HIDE),
    ).toBe(InboxEmptinesses.HIDDEN_BY_DEFAULT);
  });

  it("tells the archived view's nothing from its hidden and filtered rows", () => {
    const ONLY = InboxArchivedFilters.ONLY;
    const repositories = [{ repoId: "1", repoSlug: "a/b" }];

    expect(
      readInboxEmptiness(
        { total: 0, repositories: [], archivedTotal: 0 },
        1,
        ONLY,
      ),
    ).toBe(InboxEmptinesses.ARCHIVED_ONLY);
    expect(
      readInboxEmptiness({ total: 0, repositories, archivedTotal: 2 }, 1, ONLY),
    ).toBe(InboxEmptinesses.HIDDEN_BY_DEFAULT);
    expect(
      readInboxEmptiness({ total: 0, repositories, archivedTotal: 2 }, 2, ONLY),
    ).toBe(InboxEmptinesses.FILTERED);
  });
});

describe("runWithConcurrency", () => {
  it("keeps at most the limit in flight and answers in order", async () => {
    let inFlight = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const outcomes = runWithConcurrency([1, 2, 3, 4, 5, 6], 4, (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<string>((resolve) => {
        releases.push(() => {
          inFlight -= 1;
          resolve(`done ${String(item)}`);
        });
      });
    });

    await Promise.resolve();
    expect(releases).toHaveLength(4);
    releases[1]?.();
    releases[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toHaveLength(6);
    for (const release of releases.slice(2)) {
      release();
    }

    expect(await outcomes).toEqual([
      "done 1",
      "done 2",
      "done 3",
      "done 4",
      "done 5",
      "done 6",
    ]);
    expect(peak).toBe(4);
  });

  it("answers an empty list at once", async () => {
    expect(await runWithConcurrency([], 4, async () => "x")).toEqual([]);
  });
});

describe("readFailedReadCode", () => {
  it("names no failure while the list's last read succeeded", () => {
    expect(readFailedReadCode(null)).toBeUndefined();
  });

  it("carries the wire code of a refused read", () => {
    const refused = new ApiError(ApiErrorCodes.GITHUB_UNAVAILABLE, 502, "/x");

    expect(readFailedReadCode(refused)).toBe(ApiErrorCodes.GITHUB_UNAVAILABLE);
  });

  it("names the server for a failure that carries no wire code", () => {
    expect(readFailedReadCode(new TypeError("Failed to fetch"))).toBe(
      ApiErrorCodes.INTERNAL_ERROR,
    );
  });
});

describe("readSearchMissReason", () => {
  const HIDE = InboxArchivedFilters.HIDE;
  const ONLY = InboxArchivedFilters.ONLY;

  function makeCounts(searchMatchTotal: number, archivedSearchMatchTotal = 0) {
    return { total: 0, searchMatchTotal, archivedSearchMatchTotal };
  }

  it("is nothing without search text or while rows show", () => {
    expect(readSearchMissReason(makeCounts(0), "", HIDE)).toBeUndefined();
    expect(
      readSearchMissReason({ ...makeCounts(4), total: 2 }, "anchor", HIDE),
    ).toBeUndefined();
  });

  it("counts the matches the filters hide in the view on screen", () => {
    expect(readSearchMissReason(makeCounts(3, 1), "anchor", HIDE)).toEqual({
      kind: SearchMissKinds.HIDDEN_BY_FILTERS,
      count: 2,
    });
    expect(readSearchMissReason(makeCounts(3, 1), "anchor", ONLY)).toEqual({
      kind: SearchMissKinds.HIDDEN_BY_FILTERS,
      count: 1,
    });
  });

  it("points at the other view when only it holds a match", () => {
    expect(readSearchMissReason(makeCounts(2, 2), "anchor", HIDE)).toEqual({
      kind: SearchMissKinds.IN_OTHER_VIEW,
      count: 2,
    });
    expect(readSearchMissReason(makeCounts(2, 0), "anchor", ONLY)).toEqual({
      kind: SearchMissKinds.IN_OTHER_VIEW,
      count: 2,
    });
  });

  it("says nowhere when no row the reviewer reaches matches", () => {
    expect(readSearchMissReason(makeCounts(0), "anchor", HIDE)).toEqual({
      kind: SearchMissKinds.NOWHERE,
    });
  });
});
