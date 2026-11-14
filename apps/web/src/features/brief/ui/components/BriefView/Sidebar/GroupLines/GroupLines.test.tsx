// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

  it("marks the current group and names its thread count", () => {
    render(
      <GroupLines
        activeGroupId={first.id}
        groupThreadCounts={new Map([[first.id, 2]])}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    const line = screen.getByRole("button", {
      name: `${firstName}, 2 threads`,
    });
    expect(line.getAttribute("aria-current")).toBe("true");
    expect(line.querySelector('[data-icon="chat-fill"]')).toBeTruthy();
  });

  it("draws no thread mark on a group without threads", () => {
    render(
      <GroupLines
        activeGroupId={null}
        groupThreadCounts={new Map([[first.id, 1]])}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: `${firstName}, 1 thread` }),
    ).toBeTruthy();
    expect(document.querySelectorAll('[data-icon="chat-fill"]')).toHaveLength(
      1,
    );
  });

  it("states the thread count in the hover callout", () => {
    render(
      <GroupLines
        activeGroupId={null}
        groupThreadCounts={new Map([[first.id, 2]])}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.pointerEnter(
      screen.getByRole("button", { name: `${firstName}, 2 threads` }),
    );
    expect(screen.getByRole("tooltip").textContent).toContain("2 threads");
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
