// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowButton } from ".";

afterEach(cleanup);

describe("RowButton", () => {
  it("renders a type=button row/full by default", () => {
    render(<RowButton>Row</RowButton>);
    const button = screen.getByRole("button", { name: "Row" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("row");
    expect(button.getAttribute("data-density")).toBe("full");
  });

  it("renders the card variant and slim density on request", () => {
    render(
      <RowButton density="slim" variant="card">
        Card
      </RowButton>,
    );
    const button = screen.getByRole("button", { name: "Card" });
    expect(button.getAttribute("data-variant")).toBe("card");
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

  it("passes through aria-expanded, data-* hooks, and refs", () => {
    let node: HTMLButtonElement | null = null;
    render(
      <RowButton
        aria-expanded={false}
        data-testid="thread-row"
        ref={(element) => {
          node = element;
        }}
      >
        Row
      </RowButton>,
    );
    const button = screen.getByTestId("thread-row");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(node).not.toBeNull();
  });
});
