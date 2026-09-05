import { describe, expect, it } from "vitest";

import { briefFixture } from "../../../utils/fixtures";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { buildReadThroughSegments } from "./ReadThroughProgress";

const model = buildBriefViewModel(briefFixture);
const titleOf = () => "Fix the cross-param leak";

describe("buildReadThroughSegments", () => {
  it("marks no segment current or past when there is no active chunk", () => {
    const segments = buildReadThroughSegments(model.groups, null, titleOf);
    expect(segments.every((segment) => !segment.isCurrent)).toBe(true);
    expect(segments.every((segment) => !segment.isPast)).toBe(true);
    expect(segments.every((segment) => segment.fillPercent === 0)).toBe(true);
  });

  it("fills the current segment by within-group chunk position, not completion", () => {
    const [group] = model.groups;
    if (!group) throw new Error("fixture has no groups");
    const secondChunk = group.chunks[1];
    if (!secondChunk) throw new Error("fixture group needs 2+ chunks");

    const segments = buildReadThroughSegments(
      model.groups,
      secondChunk.id,
      titleOf,
    );
    const current = segments.find((segment) => segment.isCurrent);
    expect(current?.groupId).toBe(group.id);
    expect(current?.fillPercent).toBe(100); // 2nd of 2 chunks in the group.
  });

  it("falls back to source-order step numbers when there is no readingOrder", () => {
    const segments = buildReadThroughSegments(model.groups, null, titleOf);
    expect(segments.map((segment) => segment.step)).toEqual(
      model.groups.map((group, index) => group.readingOrderStep ?? index + 1),
    );
  });

  it("flags hasReadingOrder false in the source-order fallback (fixture has no readingOrder)", () => {
    const segments = buildReadThroughSegments(model.groups, null, titleOf);
    expect(segments.every((segment) => !segment.hasReadingOrder)).toBe(true);
  });
});
