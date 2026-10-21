// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CALLOUT_HOVER_DELAY_MS } from "../Callout/consts";
import { IconButton } from ".";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A pointer resting on the control past the callout's hover delay. */
function restPointer(button: HTMLElement): void {
  fireEvent.pointerEnter(button);
  act(() => {
    vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
  });
}

describe("IconButton", () => {
  it("renders a ghost sm type=button with the label as aria-label", () => {
    render(<IconButton label="Copy path">×</IconButton>);
    const button = screen.getByRole("button", { name: "Copy path" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("ghost");
    expect(button.getAttribute("data-size")).toBe("sm");
  });

  it("keeps the compact callout on label when aria-label is longer", () => {
    render(
      <IconButton
        aria-label="Add a comment on src/deeply/nested/path/a.ts"
        callout="left"
        label="Comment on file"
      >
        +
      </IconButton>,
    );
    vi.useFakeTimers();
    const button = screen.getByRole("button", {
      name: "Add a comment on src/deeply/nested/path/a.ts",
    });
    restPointer(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Comment on file");
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

  it("disabled uses aria-disabled and ignores clicks", () => {
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

  it("aria-disabled without disabled still fires clicks", () => {
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
    vi.useFakeTimers();
    render(
      <IconButton callout="left" label="Scroll to top">
        ↑
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Scroll to top" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    restPointer(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Scroll to top");

    fireEvent.focus(button);
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a pointer that leaves before the delay earns no callout", () => {
    vi.useFakeTimers();
    render(
      <IconButton callout="left" label="Scroll to top">
        ↑
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Scroll to top" });

    fireEvent.pointerEnter(button);
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS / 2);
    });
    fireEvent.pointerLeave(button);
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("shows no callout without the prop", () => {
    vi.useFakeTimers();
    render(<IconButton label="Copy path">×</IconButton>);
    const button = screen.getByRole("button", { name: "Copy path" });

    restPointer(button);
    fireEvent.focus(button);
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
