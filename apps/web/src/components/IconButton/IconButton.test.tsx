// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IconButton } from "./IconButton";

afterEach(cleanup);

describe("IconButton", () => {
  it("renders a ghost sm type=button with the label as aria-label", () => {
    render(<IconButton label="Copy path">×</IconButton>);
    const button = screen.getByRole("button", { name: "Copy path" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("ghost");
    expect(button.getAttribute("data-size")).toBe("sm");
  });

  it("a caller aria-label overrides the label", () => {
    render(
      <IconButton aria-label="Next revision" label="Next">
        →
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Next revision" })).toBeTruthy();
  });

  it("autoWidth stamps data-width for labeled icon content", () => {
    render(
      <IconButton autoWidth label="go to change-group g1">
        ↳ g1
      </IconButton>,
    );
    const button = screen.getByRole("button", {
      name: "go to change-group g1",
    });
    expect(button.getAttribute("data-width")).toBe("auto");
  });

  it("disabled renders aria-disabled, never the native attribute, and guards clicks", () => {
    const onClick = vi.fn();
    render(
      <IconButton disabled label="Go" onClick={onClick}>
        →
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("caller-passed aria-disabled without the disabled prop keeps clicks live", () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-disabled label="Prev" onClick={onClick}>
        ←
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Prev" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows its label in a callout on hover and focus when asked", () => {
    render(
      <IconButton callout="left" label="Scroll to top">
        ↑
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Scroll to top" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerEnter(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Scroll to top");

    fireEvent.focus(button);
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows no callout without the prop", () => {
    render(<IconButton label="Copy path">×</IconButton>);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Copy path" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("passes through className, refs, roving tabIndex, and data-* hooks", () => {
    let node: HTMLButtonElement | null = null;
    render(
      <IconButton
        className="extra"
        data-testid="icon"
        label="Bold"
        ref={(element) => {
          node = element;
        }}
        tabIndex={-1}
      >
        B
      </IconButton>,
    );
    const button = screen.getByTestId("icon");
    expect(button.className).toContain("extra");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(node).not.toBeNull();
  });
});
