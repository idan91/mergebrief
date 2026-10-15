// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolbarButton } from ".";

describe("ToolbarButton", () => {
  it("renders a type=button skin and fires onClick", () => {
    const onClick = vi.fn();
    render(<ToolbarButton onClick={onClick}>Filter</ToolbarButton>);
    const button = screen.getByRole("button", { name: "Filter" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("passes aria-pressed and aria-expanded through as call-site state", () => {
    render(
      <ToolbarButton aria-expanded={false} aria-pressed="mixed">
        Collapse
      </ToolbarButton>,
    );
    const button = screen.getByRole("button", { name: "Collapse" });
    expect(button.getAttribute("aria-pressed")).toBe("mixed");
    expect(button.getAttribute("aria-expanded")).toBe("false");
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
});
