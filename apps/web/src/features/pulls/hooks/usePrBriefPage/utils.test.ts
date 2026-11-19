import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../utils/dbTimeline";
import {
  buildRevisionSpansKey,
  derivePostingDisabledReason,
  deriveReadOnlyReason,
  deriveRevisionPosture,
  deriveSelectedSpanKey,
  findJumpRevision,
  parseRevisionSpansKey,
  readPinnedRev,
  shouldPinRev,
} from "./utils";

function makePoint(
  headIndex: number,
  headSha: string,
  baseSha = "base-1",
): DbTimelinePoint {
  return { headIndex, headSha, baseSha, comparisons: {} };
}

function makeTimeline(
  points: readonly DbTimelinePoint[],
  selectedIndex: number,
  degraded = false,
): DbTimelineSelection {
  return { points, selected: points[selectedIndex]!, selectedIndex, degraded };
}

const OLDER = makePoint(1, "head-1");
const LATEST = makePoint(2, "head-2");

describe("deriveRevisionPosture", () => {
  it("reads the latest revision as current and writable", () => {
    expect(
      deriveRevisionPosture(
        { headSha: "head-2", baseSha: "base-1" },
        makeTimeline([OLDER, LATEST], 1),
        "head-2",
      ),
    ).toEqual({
      baseDrift: false,
      staleHead: false,
      newerRevisionSelectable: false,
    });
  });

  it("reads an older revision as a stale head with a newer one to go to", () => {
    expect(
      deriveRevisionPosture(
        { headSha: "head-2", baseSha: "base-1" },
        makeTimeline([OLDER, LATEST], 0),
        "head-1",
      ),
    ).toEqual({
      baseDrift: false,
      staleHead: true,
      newerRevisionSelectable: true,
    });
  });

  it("reads base drift only on the current head", () => {
    const meta = { headSha: "head-2", baseSha: "base-9" };

    expect(
      deriveRevisionPosture(meta, makeTimeline([OLDER, LATEST], 1), "head-2")
        .baseDrift,
    ).toBe(true);
    expect(
      deriveRevisionPosture(meta, makeTimeline([OLDER, LATEST], 0), "head-1")
        .baseDrift,
    ).toBe(false);
  });

  it("reads no drift when the meta has no base or no head", () => {
    expect(
      deriveRevisionPosture({}, makeTimeline([LATEST], 0), "head-2"),
    ).toEqual({
      baseDrift: false,
      staleHead: false,
      newerRevisionSelectable: false,
    });
  });

  it("offers the newest revision when there is no timeline", () => {
    expect(
      deriveRevisionPosture(
        { headSha: "head-2", baseSha: "base-1" },
        undefined,
        undefined,
      ),
    ).toEqual({
      baseDrift: false,
      staleHead: false,
      newerRevisionSelectable: true,
    });
  });
});

describe("deriveSelectedSpanKey", () => {
  it("tells duplicate-head revisions apart by their base", () => {
    const first = makeTimeline([makePoint(1, "head-1", "base-a")], 0);
    const second = makeTimeline([makePoint(1, "head-1", "base-b")], 0);

    expect(deriveSelectedSpanKey(first)).not.toBe(
      deriveSelectedSpanKey(second),
    );
    expect(deriveSelectedSpanKey(undefined)).toBeUndefined();
  });
});

describe("readPinnedRev", () => {
  it("pins the selected revision unless the request degraded", () => {
    expect(readPinnedRev(makeTimeline([OLDER, LATEST], 0))).toBe(1);
    expect(readPinnedRev(makeTimeline([OLDER, LATEST], 1, true))).toBe(
      undefined,
    );
    expect(readPinnedRev(undefined)).toBeUndefined();
  });
});

describe("shouldPinRev", () => {
  it("writes when the rev differs or a legacy span key remains", () => {
    expect(shouldPinRev({ rev: 2 }, 2)).toBe(false);
    expect(shouldPinRev({}, 2)).toBe(true);
    expect(shouldPinRev({ rev: 1 }, 2)).toBe(true);
    expect(shouldPinRev({ rev: 2, head: "head-2" }, 2)).toBe(true);
    expect(shouldPinRev({ rev: 2, base: "base-1" }, 2)).toBe(true);
    expect(shouldPinRev({ head: "head-2" }, undefined)).toBe(false);
  });
});

describe("revision spans key", () => {
  it("survives a round trip and is stable for an equal timeline", () => {
    const timeline = makeTimeline([OLDER, LATEST], 1);
    const key = buildRevisionSpansKey(timeline);

    expect(key).toBe(buildRevisionSpansKey(makeTimeline([OLDER, LATEST], 0)));
    expect(parseRevisionSpansKey(key ?? "")).toEqual([
      { headSha: "head-1", headIndex: 1 },
      { headSha: "head-2", headIndex: 2 },
    ]);
    expect(buildRevisionSpansKey(undefined)).toBeUndefined();
  });
});

describe("findJumpRevision", () => {
  it("picks the highest index among duplicate heads", () => {
    const spans = [
      { headSha: "head-1", headIndex: 1 },
      { headSha: "head-1", headIndex: 2 },
      { headSha: "head-3", headIndex: 3 },
    ];

    expect(findJumpRevision(spans, "head-1")).toBe(2);
    expect(findJumpRevision(spans, "head-9")).toBeUndefined();
  });
});

describe("deriveReadOnlyReason", () => {
  const translate = ((key: string) => key) as unknown as TFunction;

  it("names base drift on a superseded base", () => {
    expect(deriveReadOnlyReason(translate, { baseDrift: true })).toEqual({
      reason: "brief.baseDriftReason",
    });
  });

  it("stays writable on the current base", () => {
    expect(
      deriveReadOnlyReason(translate, { baseDrift: false }),
    ).toBeUndefined();
  });
});

describe("derivePostingDisabledReason", () => {
  const translate = ((key: string) => key) as unknown as TFunction;

  it("turns posting off in the demo build", () => {
    expect(derivePostingDisabledReason(translate, true)).toEqual({
      reason: "brief.demoPostingReason",
    });
  });

  it("leaves posting on outside the demo", () => {
    expect(derivePostingDisabledReason(translate, false)).toBeUndefined();
  });
});
