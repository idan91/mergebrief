// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "../../../utils/fixtures";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { GroupTocBar } from "./GroupTocBar";

const model = buildBriefViewModel(briefFixture);

afterEach(cleanup);

describe("GroupTocBar", () => {
  it("renders one line per Change-group, labelled by group name", () => {
    render(
      <GroupTocBar
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    const lines = screen.getAllByRole("button");
    expect(lines).toHaveLength(model.groups.length);
    for (const group of model.groups) {
      const name = group.group.title || group.group.summary;
      expect(screen.getByTitle(name)).toBeTruthy();
    }
  });

  it("jumps to the group on click", () => {
    const jumpToGroup = vi.fn();
    render(
      <GroupTocBar
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={jumpToGroup}
      />,
    );
    const first = model.groups[0];
    if (!first) throw new Error("fixture has no groups");
    fireEvent.click(
      screen.getByTitle(first.group.title || first.group.summary),
    );
    expect(jumpToGroup).toHaveBeenCalledWith(first.id);
  });

  it("marks the active group with aria-current", () => {
    const active = model.groups[0];
    if (!active) throw new Error("fixture has no groups");
    render(
      <GroupTocBar
        activeGroupId={active.id}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    const line = screen.getByTitle(active.group.title || active.group.summary);
    expect(line.getAttribute("aria-current")).toBe("true");
  });

  it("surfaces the group name in a callout on hover", () => {
    const target = model.groups[0];
    if (!target) throw new Error("fixture has no groups");
    render(
      <GroupTocBar
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.pointerEnter(
      screen.getByTitle(target.group.title || target.group.summary),
    );
    expect(screen.getByRole("tooltip").textContent).toContain(
      target.group.title || target.group.summary,
    );
  });
});
