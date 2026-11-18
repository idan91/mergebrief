// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RowButton } from ".";

describe("RowButton", () => {
  it("renders a type=button row/full by default", () => {
    render(<RowButton>Row</RowButton>);
    const button = screen.getByRole("button", { name: "Row" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("row");
    expect(button.getAttribute("data-density")).toBe("full");
  });

  it("renders the item variant and slim density on request", () => {
    render(
      <RowButton density="slim" variant="item">
        Item
      </RowButton>,
    );
    const button = screen.getByRole("button", { name: "Item" });
    expect(button.getAttribute("data-variant")).toBe("item");
    expect(button.getAttribute("data-density")).toBe("slim");
  });

  it("disabled sets aria-disabled, not the native one, and guards clicks", () => {
    const onClick = vi.fn();
    render(
      <RowButton disabled onClick={onClick}>
        Row
      </RowButton>,
    );
    const button = screen.getByRole("button", { name: "Row" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
