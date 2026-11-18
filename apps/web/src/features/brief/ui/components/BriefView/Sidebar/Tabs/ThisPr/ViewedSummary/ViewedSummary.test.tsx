// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "../../../../../../../model/utils/view-model";
import { ViewedSummary } from ".";

const session = vi.hoisted(() => ({
  reviewedChunks: new Set<string>(),
}));

vi.mock("@web/features/review/session", () => ({
  useReviewSession: (
    select: (state: { reviewedChunks: ReadonlySet<string> }) => unknown,
  ) => select(session),
}));

const fixtureGroups = buildBriefViewModel(briefFixture).groups;
const firstGroup = fixtureGroups.find((group) => group.chunks.length > 1);
const [firstChunk, otherChunk] = firstGroup?.chunks ?? [];
if (
  firstGroup === undefined ||
  firstChunk === undefined ||
  otherChunk === undefined
) {
  throw new Error("fixture needs a group with two chunks");
}
const secondChunk = { ...otherChunk, id: "second-group-chunk" };
const secondGroup = {
  ...firstGroup,
  id: "second-group",
  chunks: [secondChunk],
};
const groups = [firstGroup, secondGroup];
const totalChunks = firstGroup.chunks.length + 1;

describe("ViewedSummary", () => {
  afterEach(() => {
    cleanup();
    session.reviewedChunks = new Set();
  });

  it("counts viewed chunks across every group over all of them", () => {
    session.reviewedChunks = new Set([firstChunk.id, secondChunk.id]);

    render(<ViewedSummary groups={groups} />);

    expect(screen.getByText(`2 of ${totalChunks} viewed`)).toBeTruthy();
  });

  it("ignores a viewed id from outside the listed groups", () => {
    session.reviewedChunks = new Set([firstChunk.id, "another-brief-chunk"]);

    render(<ViewedSummary groups={groups} />);

    expect(screen.getByText(`1 of ${totalChunks} viewed`)).toBeTruthy();
  });

  it("reads zero of zero when no group is listed", () => {
    render(<ViewedSummary groups={[]} />);

    expect(screen.getByText("0 of 0 viewed")).toBeTruthy();
  });
});
