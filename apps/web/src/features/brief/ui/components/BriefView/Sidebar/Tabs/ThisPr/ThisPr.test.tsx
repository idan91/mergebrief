// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeGroupCategories } from "types";
import { briefFixture } from "@web/features/brief/test-utils";
import { GroupViewKinds } from "../../../../../../model/utils/remainder";
import { buildBriefViewModel } from "../../../../../../model/utils/viewModel";
import { ThisPr } from ".";

const model = buildBriefViewModel(briefFixture);
const first = model.groups[0];
if (!first || first.kind !== GroupViewKinds.ATTRIBUTED) {
  throw new Error("fixture has no attributed group");
}
const firstName = first.group.title || first.group.summary;

afterEach(cleanup);

describe("ThisPr", () => {
  it("lists every group as a numbered row", () => {
    render(
      <ThisPr
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(model.groups.length);
    const row = screen.getByRole("button", { name: new RegExp(firstName) });
    expect(row.textContent).toContain(
      `${first.coreChunks.length} core · ${first.supportingChunks.length} supporting`,
    );
    expect(row.textContent).toContain("bugfix");
  });

  it("shows a move-with-edits group as move with edits", () => {
    const movedGroup = {
      ...first.group,
      dominantCategory: ChangeGroupCategories.MOVE_WITH_EDITS,
    };
    const movedBrief = { ...briefFixture, changeGroups: [movedGroup] };
    const movedModel = buildBriefViewModel(movedBrief);

    render(
      <ThisPr
        activeGroupId={null}
        groups={movedModel.groups}
        jumpToGroup={() => {}}
      />,
    );

    const row = screen.getByRole("button", { name: new RegExp(firstName) });
    expect(row.textContent).toContain("move with edits");
    expect(row.textContent).not.toContain("with-edits");
  });

  it("marks the current row and the ones carrying conversation", () => {
    render(
      <ThisPr
        activeGroupId={first.id}
        conversationGroupIds={new Set([first.id])}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    const row = screen.getByRole("button", { name: new RegExp(firstName) });
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.textContent).toContain("has conversation");
  });

  it("jumps with the click event", () => {
    const jumpToGroup = vi.fn();
    render(
      <ThisPr
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={jumpToGroup}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(firstName) }),
    );
    expect(jumpToGroup).toHaveBeenCalledWith(first.id, expect.anything());
  });
});
