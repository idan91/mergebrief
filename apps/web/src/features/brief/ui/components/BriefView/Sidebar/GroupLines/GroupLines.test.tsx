// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { GroupViewKinds } from "../../../../../model/utils/remainder";
import { buildBriefViewModel } from "../../../../../model/utils/view-model";
import { GroupLines } from ".";

const model = buildBriefViewModel(briefFixture);
const first = model.groups[0];
if (!first || first.kind !== GroupViewKinds.ATTRIBUTED) {
  throw new Error("fixture has no attributed group");
}
const firstName = first.group.title || first.group.summary;

afterEach(cleanup);

describe("GroupLines", () => {
  it("renders one line per change group, named by the group", () => {
    render(
      <GroupLines
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(model.groups.length);
    expect(screen.getByRole("button", { name: firstName })).toBeTruthy();
  });

  it("marks the current group and appends the conversation note", () => {
    render(
      <GroupLines
        activeGroupId={first.id}
        conversationGroupIds={new Set([first.id])}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    const line = screen.getByRole("button", {
      name: `${firstName} — has conversation`,
    });
    expect(line.getAttribute("aria-current")).toBe("true");
  });

  it("jumps with the click event", () => {
    const jumpToGroup = vi.fn();
    render(
      <GroupLines
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={jumpToGroup}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: firstName }));
    expect(jumpToGroup).toHaveBeenCalledWith(first.id, expect.anything());
  });

  it("names the group in a callout on hover and drops it on blur", () => {
    render(
      <GroupLines
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    const line = screen.getByRole("button", { name: firstName });

    fireEvent.pointerEnter(line);
    expect(screen.getByRole("tooltip").textContent).toContain(firstName);

    fireEvent.focus(line);
    fireEvent.blur(line);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
