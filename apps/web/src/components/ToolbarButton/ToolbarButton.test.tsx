// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolbarButton } from ".";
import { ToolbarButtonVariants } from "./types";

describe("ToolbarButton", () => {
  it("renders a type=button skin and fires onClick", () => {
    const onClick = vi.fn();
    render(<ToolbarButton onClick={onClick}>Filter</ToolbarButton>);
    const button = screen.getByRole("button", { name: "Filter" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled sets aria-disabled, not the native one, and guards clicks", () => {
    const onClick = vi.fn();
    render(
      <ToolbarButton disabled onClick={onClick}>
        Filter
      </ToolbarButton>,
    );
    const button = screen.getByRole("button", { name: "Filter" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is boxed by default and ghost when asked", () => {
    render(
      <>
        <ToolbarButton>Filter</ToolbarButton>
        <ToolbarButton variant={ToolbarButtonVariants.GHOST}>
          Collapse
        </ToolbarButton>
      </>,
    );
    expect(
      screen
        .getByRole("button", { name: "Filter" })
        .getAttribute("data-variant"),
    ).toBe("boxed");
    expect(
      screen
        .getByRole("button", { name: "Collapse" })
        .getAttribute("data-variant"),
    ).toBe("ghost");
  });
});
