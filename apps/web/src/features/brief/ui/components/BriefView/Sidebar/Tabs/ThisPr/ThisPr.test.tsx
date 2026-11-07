// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangeGroupCategories } from "types";
import { briefFixture } from "@web/features/brief/test-utils";
import { GroupViewKinds } from "../../../../../../model/utils/remainder";
import { buildBriefViewModel } from "../../../../../../model/utils/view-model";
import { ThisPr } from ".";

const model = buildBriefViewModel(briefFixture);
const first = model.groups[0];
if (!first || first.kind !== GroupViewKinds.ATTRIBUTED) {
  throw new Error("fixture has no attributed group");
}
const firstName = first.group.title || first.group.summary;

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
    expect(row.textContent).toContain("Bug fix");
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
    expect(row.textContent).toContain("Move with edits");
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

  it("lists no chunk rows when no chunk jump is wired", () => {
    render(
      <ThisPr
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(model.groups.length);
  });
});
