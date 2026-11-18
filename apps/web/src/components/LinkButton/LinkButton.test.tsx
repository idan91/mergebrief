// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LinkButton } from ".";

describe("LinkButton", () => {
  it("renders a type=button text action and fires onClick", () => {
    const onClick = vi.fn();
    render(<LinkButton onClick={onClick}>Show description</LinkButton>);
    const button = screen.getByRole("button", { name: "Show description" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled sets aria-disabled, not the native one, and guards clicks", () => {
    const onClick = vi.fn();
    render(
      <LinkButton disabled onClick={onClick}>
        Jump
      </LinkButton>,
    );
    const button = screen.getByRole("button", { name: "Jump" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes through aria-expanded, data-* hooks, className, and refs", () => {
    let node: HTMLButtonElement | null = null;
    render(
      <LinkButton
        aria-expanded={false}
        className="extra"
        data-testid="toggle"
        ref={(element) => {
          node = element;
        }}
      >
        Show original
      </LinkButton>,
    );
    const button = screen.getByTestId("toggle");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.className).toContain("extra");
    expect(node).not.toBeNull();
  });
});
