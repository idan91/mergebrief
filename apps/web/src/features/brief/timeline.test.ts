import { describe, expect, it } from "vitest";

import { buildBriefTimeline } from "./timeline";

describe("buildBriefTimeline", () => {
  it("groups a delta with its full-brief head instead of making it a separate point", () => {
    const timeline = buildBriefTimeline([
      { id: "brief-1", artifactKind: "brief", repo: "acme/widgets", number: 7, title: "Add widgets", sha: "11111111", index: 1 },
      { id: "brief-2", artifactKind: "brief", repo: "acme/widgets", number: 7, title: "Add widgets", sha: "22222222", index: 2 },
      { id: "delta-1-2", artifactKind: "delta", repo: "acme/widgets", number: 7, title: "Add widgets", sha: "22222222", baselineSha: "11111111", headSha: "22222222", baselineIndex: 1, headIndex: 2 },
      { id: "other-pr", artifactKind: "brief", repo: "acme/other", number: 8, title: "Other", sha: "33333333", index: 1 },
    ], "brief-2");

    expect(timeline.points).toEqual([
      { briefId: "brief-1", headSha: "11111111", index: 1 },
      { briefId: "brief-2", deltaId: "delta-1-2", headSha: "22222222", index: 2 },
    ]);
    expect(timeline.selectedPoint?.briefId).toBe("brief-2");
    expect(timeline.selectedPoint?.deltaId).toBe("delta-1-2");
  });

  it("selects the matching full point when the current artifact is a delta", () => {
    const timeline = buildBriefTimeline([
      { id: "brief-1", artifactKind: "brief", repo: "acme/widgets", number: 7, title: "Add widgets", sha: "11111111", index: 1 },
      { id: "brief-2", artifactKind: "brief", repo: "acme/widgets", number: 7, title: "Add widgets", sha: "22222222", index: 2 },
      { id: "delta-1-2", artifactKind: "delta", repo: "acme/widgets", number: 7, title: "Add widgets", sha: "22222222", baselineSha: "11111111", headSha: "22222222", baselineIndex: 1, headIndex: 2 },
    ], "delta-1-2");

    expect(timeline.selectedPoint?.briefId).toBe("brief-2");
  });
});
