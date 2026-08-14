// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuItem } from "./MenuItem";

afterEach(cleanup);

describe("MenuItem", () => {
  it("renders role=menuitem type=button by default with no aria-checked", () => {
    render(<MenuItem>Clear drafts</MenuItem>);
    const item = screen.getByRole("menuitem", { name: "Clear drafts" });
    expect(item.getAttribute("type")).toBe("button");
    expect(item.hasAttribute("aria-checked")).toBe(false);
  });

  it("radio and checkbox roles require and render checked", () => {
    render(
      <>
        <MenuItem checked kind="menuitemradio">
          English
        </MenuItem>
        <MenuItem checked={false} kind="menuitemcheckbox">
          Set default
        </MenuItem>
      </>,
    );
    expect(
      screen
        .getByRole("menuitemradio", { name: "English" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Set default" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("disabled renders aria-disabled, never the native attribute, and guards clicks", () => {
    const onClick = vi.fn();
    render(
      <MenuItem disabled onClick={onClick}>
        Switch org
      </MenuItem>,
    );
    const item = screen.getByRole("menuitem", { name: "Switch org" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.hasAttribute("disabled")).toBe(false);
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes through roving tabIndex, refs, and keyboard handlers", () => {
    const onKeyDown = vi.fn();
    let node: HTMLButtonElement | null = null;
    render(
      <MenuItem
        ref={(element) => {
          node = element;
        }}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        Item
      </MenuItem>,
    );
    const item = screen.getByRole("menuitem", { name: "Item" });
    expect(item.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(item, { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(node).not.toBeNull();
  });
});
