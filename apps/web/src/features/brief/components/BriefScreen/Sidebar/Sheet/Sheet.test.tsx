// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/fixtures";
import { buildBriefViewModel } from "../../../../utils/viewModel";
import { Sheet, type SheetProps } from ".";

const model = buildBriefViewModel(briefFixture);

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function noop(): void {}

function renderSheet(overrides: Partial<SheetProps> = {}) {
  const props: SheetProps = {
    groups: model.groups,
    activeGroupId: null,
    tab: "this-pr",
    selectTab: noop,
    jumpToGroup: noop,
    afterRevision: noop,
    close: noop,
    ...overrides,
  };
  return render(<Sheet {...props} />);
}

describe("Sheet", () => {
  it("opens as a half-height modal dialog focused on the active tab", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Sidebar" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-height")).toBe("half");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "This PR" }),
    );
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("locks the page scroll while mounted and releases it after", () => {
    const { unmount } = renderSheet();
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("the handle toggles between half and full", () => {
    renderSheet();
    const handle = screen.getByRole("button", {
      name: "Expand the sheet to full height",
    });

    fireEvent.click(handle);
    expect(screen.getByRole("dialog").getAttribute("data-height")).toBe("full");
    expect(
      screen.getByRole("button", { name: "Shrink the sheet to half height" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Shrink the sheet to half height" }),
    );
    expect(screen.getByRole("dialog").getAttribute("data-height")).toBe("half");
  });

  it("the scrim closes", () => {
    const close = vi.fn();
    renderSheet({ close });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Collapse sidebar" })[0]!,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("traps Tab inside the dialog", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const last = buttons[buttons.length - 1];
    if (!last) throw new Error("no controls");
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });

    expect(document.activeElement).toBe(buttons[0]);
  });
});
