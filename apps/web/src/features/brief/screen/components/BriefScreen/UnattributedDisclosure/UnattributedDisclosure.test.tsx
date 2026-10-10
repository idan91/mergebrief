// @vitest-environment jsdom
import { appI18n } from "../../../../../../i18n/I18nProvider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupViewKinds } from "../../../../model/utils/remainder";
import type { UnattributedRemainderGroupView } from "../../../../model/utils/viewModel";
import { UnattributedDisclosure } from ".";

afterEach(cleanup);

const group: UnattributedRemainderGroupView = {
  kind: GroupViewKinds.UNATTRIBUTED_REMAINDER,
  id: GroupViewKinds.UNATTRIBUTED_REMAINDER,
  index: 2,
  chunks: [],
  added: 4,
  deleted: 2,
};

function renderDisclosure(
  overrides: Partial<{
    jumpToGroup: (groupId: string) => void;
    jumpToGroupHeading: (groupId: string) => void;
  }> = {},
) {
  const jumpToGroup = overrides.jumpToGroup ?? vi.fn();
  const jumpToGroupHeading = overrides.jumpToGroupHeading ?? vi.fn();
  render(
    <UnattributedDisclosure
      group={group}
      jumpToGroup={jumpToGroup}
      jumpToGroupHeading={jumpToGroupHeading}
    />,
  );
  return { jumpToGroup, jumpToGroupHeading };
}

describe("UnattributedDisclosure", () => {
  it("renders a closed trigger named by the lowercase label and counts", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    expect(trigger.dataset["state"]).toBe("closed");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("unattributed");
    expect(trigger.textContent).toContain("+4");
    expect(trigger.textContent).toContain("−2");
  });

  it("opens on click with the remainder title, note, and Jump", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    fireEvent.click(trigger);
    expect(trigger.dataset["state"]).toBe("open");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByText(appI18n.t("brief.unattributed.remainderTitle")),
    ).toBeTruthy();
    expect(
      screen.getByText(appI18n.t("brief.unattributed.remainderSummary")),
    ).toBeTruthy();
    expect(
      screen.getByText(appI18n.t("brief.unattributed.calloutNote")),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: appI18n.t("brief.unattributed.jumpToGroup"),
      }),
    ).toBeTruthy();
    expect(screen.queryByText("src/orphan.ts")).toBeNull();
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the callout open when focus moves to Jump", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    fireEvent.click(trigger);
    const jump = screen.getByRole("button", {
      name: appI18n.t("brief.unattributed.jumpToGroup"),
    });
    fireEvent.blur(trigger, { relatedTarget: jump });
    expect(trigger.dataset["state"]).toBe("open");
  });

  it("keeps the callout open when Tab lands on a floating-ui focus guard", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    fireEvent.click(trigger);
    const guard = document.createElement("span");
    guard.setAttribute("data-floating-ui-focus-guard", "");
    document.body.append(guard);
    fireEvent.blur(trigger, { relatedTarget: guard });
    expect(trigger.dataset["state"]).toBe("open");
    guard.remove();
  });

  it("closes on Escape from Jump and stays closed when focus returns", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    fireEvent.click(trigger);
    const jump = screen.getByRole("button", {
      name: appI18n.t("brief.unattributed.jumpToGroup"),
    });
    jump.focus();
    const matches = vi
      .spyOn(trigger, "matches")
      .mockImplementation((selector) => selector === ":focus-visible");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.dataset["state"]).toBe("closed");
    expect(document.activeElement).toBe(trigger);
    matches.mockRestore();
  });

  it("Escape from a hover-opened callout dismisses without moving focus", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    const wrap = trigger.parentElement;
    if (wrap === null) {
      throw new Error("expected wrap");
    }
    fireEvent.pointerEnter(wrap, { pointerType: "mouse" });
    expect(trigger.dataset["state"]).toBe("open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.dataset["state"]).toBe("closed");
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("a pointer Jump takes the plain group landing", () => {
    const { jumpToGroup, jumpToGroupHeading } = renderDisclosure();
    fireEvent.click(screen.getByTestId("unattributed-disclosure"));
    fireEvent.click(
      screen.getByRole("button", {
        name: appI18n.t("brief.unattributed.jumpToGroup"),
      }),
      { detail: 1 },
    );
    expect(jumpToGroup).toHaveBeenCalledWith(
      GroupViewKinds.UNATTRIBUTED_REMAINDER,
    );
    expect(jumpToGroupHeading).not.toHaveBeenCalled();
  });

  it("a keyboard Jump takes the heading landing", () => {
    const { jumpToGroup, jumpToGroupHeading } = renderDisclosure();
    fireEvent.click(screen.getByTestId("unattributed-disclosure"));
    fireEvent.click(
      screen.getByRole("button", {
        name: appI18n.t("brief.unattributed.jumpToGroup"),
      }),
      { detail: 0 },
    );
    expect(jumpToGroupHeading).toHaveBeenCalledWith(
      GroupViewKinds.UNATTRIBUTED_REMAINDER,
    );
    expect(jumpToGroup).not.toHaveBeenCalled();
  });
});
