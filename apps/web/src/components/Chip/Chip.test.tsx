// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Chip } from ".";

afterEach(cleanup);

describe("Chip", () => {
  it("renders a neutral type=button chip by default", () => {
    render(<Chip>open</Chip>);
    const chip = screen.getByRole("button", { name: "open" });
    expect(chip.getAttribute("type")).toBe("button");
    expect(chip.getAttribute("data-tone")).toBe("neutral");
    expect(chip.hasAttribute("aria-pressed")).toBe(false);
  });

  it("pressed is controlled and renders aria-pressed", () => {
    render(<Chip pressed>filter</Chip>);
    expect(
      screen
        .getByRole("button", { name: "filter" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("draws the check mark only while pressed", () => {
    const { rerender } = render(<Chip>filter</Chip>);
    const chip = screen.getByRole("button", { name: "filter" });
    expect(chip.querySelector('[data-icon="check"]')).toBeNull();

    rerender(<Chip pressed>filter</Chip>);
    expect(chip.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it("the span branch renders static content without button semantics", () => {
    render(
      <Chip as="span" data-testid="static" tone="warning">
        stale
      </Chip>,
    );
    const chip = screen.getByTestId("static");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.getAttribute("data-tone")).toBe("warning");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disabled renders aria-disabled, no native attribute, and guards clicks", () => {
    const onClick = vi.fn();
    render(
      <Chip disabled onClick={onClick}>
        filter
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "filter" });
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.hasAttribute("disabled")).toBe(false);
    fireEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes through aria-expanded, data-* hooks, and className", () => {
    render(
      <Chip aria-expanded={false} className="extra" data-testid="chip">
        warnings
      </Chip>,
    );
    const chip = screen.getByTestId("chip");
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.className).toContain("extra");
  });
});
