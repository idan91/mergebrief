// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { GroupViewKinds } from "../../../../../model/utils/remainder";
import { buildBriefViewModel } from "../../../../../model/utils/view-model";
import { NarrowBar, type NarrowBarProps } from ".";

const model = buildBriefViewModel(briefFixture);
const first = model.groups[0];
if (!first || first.kind !== GroupViewKinds.ATTRIBUTED) {
  throw new Error("fixture has no attributed group");
}
// Two groups make the stepper's neighbour reachable; the fixture ships one.
const second = { ...first, id: "g-second", index: 1 };
const groups = [first, second];

function noop(): void {}

function renderBar(overrides: Partial<NarrowBarProps> = {}) {
  const props: NarrowBarProps = {
    groups,
    activeGroupId: null,
    expanded: false,
    chevronRef: createRef<HTMLButtonElement | null>(),
    toggle: noop,
    jumpToGroup: noop,
    toggleShortcuts: noop,
    scrollToTop: noop,
    ...overrides,
  };
  return render(<NarrowBar {...props} />);
}

describe("NarrowBar", () => {
  it("lays out chevron, arrows, position, scroll-to-top and shortcuts", () => {
    renderBar({ activeGroupId: second.id });
    const collapsed = screen.getByRole("button", { name: "Expand sidebar" });
    const caret = collapsed.querySelector('[data-icon="caret-down"]');
    expect(caret?.getAttribute("data-rotation")).toBe("180");
    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "Expand sidebar",
      "Previous group",
      "Next group",
      "Scroll to top",
      "Keyboard shortcuts",
    ]);
    expect(
      screen.getByText(second.group.title || second.group.summary),
    ).toBeTruthy();
    expect(screen.getByText("Group 2/2")).toBeTruthy();
  });

  it("steps through the arrows with clamping", () => {
    const jumpToGroup = vi.fn();
    renderBar({ activeGroupId: first.id, jumpToGroup });

    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    expect(jumpToGroup).toHaveBeenLastCalledWith(second.id);

    fireEvent.click(screen.getByRole("button", { name: "Previous group" }));
    expect(jumpToGroup).toHaveBeenLastCalledWith(first.id);
  });

  it("lines are not tap targets", () => {
    renderBar();
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("wires the chevron, scroll-to-top and shortcuts", () => {
    const toggle = vi.fn();
    const scrollToTop = vi.fn();
    const toggleShortcuts = vi.fn();
    renderBar({ toggle, scrollToTop, toggleShortcuts, expanded: true });

    const chevron = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    const caret = chevron.querySelector('[data-icon="caret-down"]');
    expect(caret?.hasAttribute("data-rotation")).toBe(false);
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("button", { name: "Scroll to top" }));
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(scrollToTop).toHaveBeenCalledTimes(1);
    expect(toggleShortcuts).toHaveBeenCalledTimes(1);
  });
});
