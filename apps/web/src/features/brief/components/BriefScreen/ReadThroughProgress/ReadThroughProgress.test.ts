import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/fixtures";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { buildReadThroughSegments } from ".";

const model = buildBriefViewModel(briefFixture);
const titleOf = () => "Fix the cross-param leak";

describe("buildReadThroughSegments", () => {
  it("marks no segment current or past when there is no active chunk", () => {
    const segments = buildReadThroughSegments(model.groups, null, titleOf);
    expect(segments.every((segment) => !segment.isCurrent)).toBe(true);
    expect(segments.every((segment) => !segment.isPast)).toBe(true);
    expect(segments.every((segment) => segment.fillPercent === 0)).toBe(true);
  });

  it("fills the segment by within-group chunk position, not completion", () => {
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

  it("numbers segments by their position in the group order", () => {
    const segments = buildReadThroughSegments(model.groups, null, titleOf);
    expect(segments.map((segment) => segment.position)).toEqual(
      model.groups.map((_group, index) => index + 1),
    );
  });
});
