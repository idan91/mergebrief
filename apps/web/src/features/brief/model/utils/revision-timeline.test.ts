import type { LocalBriefSummary } from "contract";
import { describe, expect, it } from "vitest";

import {
  buildRevisionTimeline,
  buildRevisionTimelineView,
} from "./revision-timeline";
import { buildBriefTimeline } from "./timeline";

function makeSummary(
  over: Partial<LocalBriefSummary> & Pick<LocalBriefSummary, "id">,
): LocalBriefSummary {
  return {
    artifactKind: "brief",
    repo: "acme/widgets",
    number: 7,
    title: "Add widgets",
    sha: "0000000000",
    ...over,
  };
}

const ARTIFACTS: LocalBriefSummary[] = [
  makeSummary({ id: "brief-2", sha: "2222222abc", index: 2 }),
  makeSummary({ id: "brief-1", sha: "1111111abc", index: 1 }),
  makeSummary({ id: "brief-3", sha: "3333333abc", index: 3 }),
  makeSummary({
    id: "delta-1-2",
    artifactKind: "delta",
    sha: "2222222abc",
    headSha: "2222222abc",
    baselineSha: "1111111abc",
  }),
];

describe("buildRevisionTimeline", () => {
  it("orders rows newest first and marks the last point newest", () => {
    const view = buildRevisionTimeline([
      { key: "a", ordinal: 1, headSha: "aaaaaaaaa", current: false },
      { key: "b", ordinal: 2, headSha: "bbbbbbbbb", current: true },
    ]);
    expect(view.rows.map((row) => row.key)).toEqual(["b", "a"]);
    expect(view.rows[0]).toEqual({
      key: "b",
      ordinal: 2,
      shortSha: "bbbbbbb",
      current: true,
      newest: true,
    });
    expect(view.rows[1]?.newest).toBe(false);
  });

  it("carries a date only where the point has one", () => {
    const view = buildRevisionTimeline([
      { key: "a", ordinal: 1, headSha: "a", current: true },
      {
        key: "b",
        ordinal: 2,
        headSha: "b",
        at: "2026-09-30T10:00:00Z",
        current: false,
      },
    ]);
    expect(view.rows[0]?.at).toBe("2026-09-30T10:00:00Z");
    expect(view.rows[1]).not.toHaveProperty("at");
  });
});

describe("buildRevisionTimelineView", () => {
  it("keys local rows by brief id, newest first, with no dates", () => {
    const view = buildRevisionTimelineView(
      buildBriefTimeline(ARTIFACTS, "brief-1"),
    );
    expect(view.rows.map((row) => row.key)).toEqual([
      "brief-3",
      "brief-2",
      "brief-1",
    ]);
    expect(view.rows.find((row) => row.current)?.key).toBe("brief-1");
    expect(view.rows.some((row) => row.at !== undefined)).toBe(false);
  });
});
