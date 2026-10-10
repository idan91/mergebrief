import type { LocalBriefSummary } from "contract";
import { describe, expect, it } from "vitest";

import { buildBriefTimeline } from "./timeline";

const headSequence = (points: { headSha: string; index: number }[]) =>
  points.map((point) => ({ headSha: point.headSha, index: point.index }));

describe("buildBriefTimeline", () => {
  it("groups a delta with its full-brief head instead of its own point", () => {
    const timeline = buildBriefTimeline(
      [
        {
          id: "brief-1",
          artifactKind: "brief",
          repo: "acme/widgets",
          number: 7,
          title: "Add widgets",
          sha: "11111111",
          index: 1,
        },
        {
          id: "brief-2",
          artifactKind: "brief",
          repo: "acme/widgets",
          number: 7,
          title: "Add widgets",
          sha: "22222222",
          index: 2,
          comparisons: {
            lastReview: {
              marksId: "marks-checkpoint-1-2",
              deltaId: "delta-1-2",
              baselineSha: "11111111",
              baselineIndex: 1,
            },
          },
        },
        {
          id: "delta-1-2",
          artifactKind: "delta",
          repo: "acme/widgets",
          number: 7,
          title: "Add widgets",
          sha: "22222222",
          baselineSha: "11111111",
          headSha: "22222222",
          baselineIndex: 1,
          headIndex: 2,
        },
        {
          id: "other-pr",
          artifactKind: "brief",
          repo: "acme/other",
          number: 8,
          title: "Other",
          sha: "33333333",
          index: 1,
        },
      ],
      "brief-2",
    );

    expect(timeline.points).toEqual([
      { briefId: "brief-1", headSha: "11111111", index: 1, comparisons: {} },
      {
        briefId: "brief-2",
        headSha: "22222222",
        index: 2,
        comparisons: {
          lastReview: {
            marksId: "marks-checkpoint-1-2",
            deltaId: "delta-1-2",
            baselineSha: "11111111",
            baselineIndex: 1,
          },
        },
      },
    ]);
    expect(timeline.selectedPoint?.briefId).toBe("brief-2");
    expect(timeline.selectedPoint?.comparisons.lastReview?.deltaId).toBe(
      "delta-1-2",
    );
  });

  it("selects the matching full point when the current artifact is a delta", () => {
    const timeline = buildBriefTimeline(
      [
        {
          id: "brief-1",
          artifactKind: "brief",
          repo: "acme/widgets",
          number: 7,
          title: "Add widgets",
          sha: "11111111",
          index: 1,
        },
        {
          id: "brief-2",
          artifactKind: "brief",
          repo: "acme/widgets",
          number: 7,
          title: "Add widgets",
          sha: "22222222",
          index: 2,
        },
        {
          id: "delta-1-2",
          artifactKind: "delta",
          repo: "acme/widgets",
          number: 7,
          title: "Add widgets",
          sha: "22222222",
          baselineSha: "11111111",
          headSha: "22222222",
          baselineIndex: 1,
          headIndex: 2,
        },
      ],
      "delta-1-2",
    );

    expect(timeline.selectedPoint?.briefId).toBe("brief-2");
  });

  it("keeps points and navigation the same whatever comparison is available", () => {
    const artifacts: LocalBriefSummary[] = [
      {
        id: "brief-1",
        artifactKind: "brief",
        repo: "acme/widgets",
        number: 7,
        title: "Add widgets",
        sha: "11111111",
        index: 1,
      },
      {
        id: "brief-2",
        artifactKind: "brief",
        repo: "acme/widgets",
        number: 7,
        title: "Add widgets",
        sha: "22222222",
        index: 2,
        comparisons: {
          previousBrief: {
            marksId: "marks-previous-brief-1-2",
            narrativeId: "brief-2",
            baselineSha: "11111111",
            baselineIndex: 1,
          },
        },
      },
      {
        id: "brief-3",
        artifactKind: "brief",
        repo: "acme/widgets",
        number: 7,
        title: "Add widgets",
        sha: "33333333",
        index: 3,
      },
    ];

    const withComparisons = buildBriefTimeline(artifacts, "brief-2");
    const withoutComparisons = buildBriefTimeline(
      artifacts.map(({ comparisons: _comparisons, ...artifact }) => artifact),
      "brief-2",
    );

    expect(headSequence(withComparisons.points)).toEqual(
      headSequence(withoutComparisons.points),
    );
    expect(withComparisons.selectedPoint?.briefId).toBe(
      withoutComparisons.selectedPoint?.briefId,
    );
    expect(withComparisons.points[1]?.comparisons.previousBrief).toBeDefined();
    expect(
      withoutComparisons.points[1]?.comparisons.previousBrief,
    ).toBeUndefined();
  });
});
