import { describe, expect, it } from "vitest";

import {
  buildPrSearch,
  parsePrSearch,
  readExplicitSpan,
  readRevisionRequest,
} from ".";
import type { PrBriefSearch, PrSearchChange } from "./types";

const EVERY_PARAM: PrBriefSearch = {
  rev: 3,
  head: "head-sha",
  base: "base-sha",
  view: "changes",
  compare: "previous-brief",
  diff: "split",
  focus: true,
  l: "chunk-a.R10-R12",
  thread: 9001,
  verdicts: "approved,commented",
  reviewers: "alice,bob",
  reviews: "all",
};

describe("parsePrSearch", () => {
  it("reads every param the PR page knows", () => {
    expect(
      parsePrSearch({
        rev: 3,
        head: "head-sha",
        base: "base-sha",
        view: "changes",
        compare: "previous-brief",
        diff: "split",
        focus: true,
        l: "chunk-a.R10-R12",
        thread: 9001,
        verdicts: "approved,commented",
        reviewers: "alice,bob",
        reviews: "all",
      }),
    ).toEqual(EVERY_PARAM);
  });

  it("reads rev and thread spelled as digit strings", () => {
    expect(parsePrSearch({ rev: "2", thread: "7", focus: "true" })).toEqual({
      rev: 2,
      thread: 7,
      focus: true,
    });
  });

  it("drops a rev or thread that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, "x", "", null, true]) {
      expect(parsePrSearch({ rev: bad, thread: bad })).toEqual({});
    }
  });

  it("keeps a legacy head alone and its base only beside it", () => {
    expect(parsePrSearch({ head: "h" })).toEqual({ head: "h" });
    expect(parsePrSearch({ base: "b" })).toEqual({});
    expect(parsePrSearch({ head: "h", base: "b" })).toEqual({
      head: "h",
      base: "b",
    });
    expect(parsePrSearch({ head: "", base: "b" })).toEqual({});
    expect(parsePrSearch({ head: "h", base: "" })).toEqual({ head: "h" });
  });

  it("drops a legacy head the router decoded as a number", () => {
    expect(parsePrSearch({ head: 1234567, base: "b" })).toEqual({});
  });

  it("omits invalid View, Compare, diff, focus and link values", () => {
    expect(
      parsePrSearch({
        view: "all",
        compare: "never",
        diff: "wide",
        focus: "yes",
        l: "",
      }),
    ).toEqual({});
  });

  it("canonicalizes the filter params and drops unknown tokens", () => {
    expect(
      parsePrSearch({
        verdicts: "nonsense,commented,dismissed,approved",
        reviewers: " alice ,,bob",
        reviews: "latest",
      }),
    ).toEqual({ verdicts: "approved,commented", reviewers: "alice,bob" });
  });

  it("drops params outside the vocabulary", () => {
    expect(parsePrSearch({ utm_source: "mail", page: 2, rev: 1 })).toEqual({
      rev: 1,
    });
  });
});

describe("buildPrSearch", () => {
  it("writes each param so parse reads it back", () => {
    const writes: PrSearchChange[] = [
      { rev: 3 },
      { head: "other-head" },
      { base: "base-sha" },
      { view: "full" },
      { compare: "off" },
      { diff: "unified" },
      { focus: true },
      { l: "chunk-b" },
      { thread: 12 },
      { verdicts: "changes-requested" },
      { reviewers: "carol" },
      { reviews: "all" },
    ];

    for (const change of writes) {
      const written = buildPrSearch({ head: "head-sha" }, change);

      expect(written).toMatchObject(change);
      expect(parsePrSearch({ ...written })).toEqual(written);
    }
  });

  it("drops a key the change sets to undefined", () => {
    expect(
      buildPrSearch(EVERY_PARAM, {
        rev: undefined,
        head: undefined,
        base: undefined,
        thread: undefined,
        l: undefined,
      }),
    ).toEqual({
      view: "changes",
      compare: "previous-brief",
      diff: "split",
      focus: true,
      verdicts: "approved,commented",
      reviewers: "alice,bob",
      reviews: "all",
    });
  });

  it("drops a legacy base once its head is dropped", () => {
    expect(
      buildPrSearch({ head: "h", base: "b" }, { head: undefined, rev: 2 }),
    ).toEqual({ rev: 2 });
  });

  it("writes rev ahead of thread", () => {
    const written = buildPrSearch({ thread: 4, l: "c1" }, { rev: 2 });

    expect(Object.keys(written)).toEqual(["rev", "l", "thread"]);
  });
});

describe("readRevisionRequest", () => {
  it("carries rev and the legacy span keys only", () => {
    expect(readRevisionRequest(EVERY_PARAM)).toEqual({
      rev: 3,
      head: "head-sha",
      base: "base-sha",
    });
    const viewOnly: PrBriefSearch = { view: "full" };

    expect(readRevisionRequest(viewOnly)).toEqual({});
  });
});

describe("readExplicitSpan", () => {
  it("addresses a span only when both legacy keys are present", () => {
    expect(readExplicitSpan({ head: "h", base: "b" })).toEqual({
      base: "b",
      head: "h",
    });
    expect(readExplicitSpan({ head: "h" })).toBeUndefined();
  });
});
