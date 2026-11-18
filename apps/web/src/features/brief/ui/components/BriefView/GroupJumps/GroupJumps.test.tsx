// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupJumps } from ".";

afterEach(cleanup);

const groupTitles = { g1: "Restore archived items" };

describe("GroupJumps", () => {
  it("jumps to the one group, named by its title", () => {
    const jumpToGroup = vi.fn();
    render(
      <GroupJumps
        groupIds={["g1"]}
        groupTitles={groupTitles}
        jumpToGroup={jumpToGroup}
      />,
    );

    const jump = screen.getByRole("button", {
      name: "Go to change-group g1: Restore archived items",
    });
    fireEvent.click(jump);

    expect(jump.textContent).toBe("↳");
    expect(jumpToGroup).toHaveBeenCalledWith("g1");
  });

  it("shows each id when there are several groups", () => {
    render(
      <GroupJumps
        groupIds={["g1", "g4"]}
        groupTitles={groupTitles}
        jumpToGroup={() => {}}
      />,
    );

    const untitled = screen.getByRole("button", {
      name: "Go to change-group g4",
    });
    expect(untitled.textContent).toContain("g4");
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("draws nothing for a row that names no group", () => {
    const { container } = render(
      <GroupJumps
        groupIds={[]}
        groupTitles={groupTitles}
        jumpToGroup={() => {}}
      />,
    );

    expect(container.childElementCount).toBe(0);
  });
});
