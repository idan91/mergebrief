// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { startColdCalloutTimers } from "@web/test/callouts";

import { Callout } from "../Callout";
import { CALLOUT_HOVER_DELAY_MS } from "../Callout/consts";
import { IconButton, IconButtonVariants } from ".";

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

function focusByKeyboard(button: HTMLElement): void {
  vi.spyOn(button, "matches").mockImplementation(
    (selector) => selector === ":focus-visible",
  );
  fireEvent.focus(button);
}

describe("IconButton", () => {
  it("renders a ghost sm type=button with the label as aria-label", () => {
    render(<IconButton label="Copy path">×</IconButton>);
    const button = screen.getByRole("button", { name: "Copy path" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("ghost");
    expect(button.getAttribute("data-size")).toBe("sm");
  });

  it("stamps the outline variant for a button that shows its edge", () => {
    render(
      <IconButton label="Go to group" variant={IconButtonVariants.OUTLINE}>
        ↳
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "Go to group" });
    expect(button.getAttribute("data-variant")).toBe("outline");
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
    startColdCalloutTimers();
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
    startColdCalloutTimers();
    render(
      <IconButton callout="left" label="Scroll to top">
        ↑
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Scroll to top" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    restPointer(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Scroll to top");

    focusByKeyboard(button);
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a pointer that leaves before the delay earns no callout", () => {
    startColdCalloutTimers();
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

    focusByKeyboard(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("waits the full rest beside an open panel callout", () => {
    startColdCalloutTimers();
    const panelAnchor = document.createElement("span");
    document.body.append(panelAnchor);
    onTestFinished(() => panelAnchor.remove());
    render(
      <>
        <Callout anchor={panelAnchor} interactive onClose={() => {}}>
          Panel
        </Callout>
        <IconButton callout="left" label="Scroll to top">
          ↑
        </IconButton>
      </>,
    );
    const button = screen.getByRole("button", { name: "Scroll to top" });

    fireEvent.pointerEnter(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(screen.getByRole("tooltip").textContent).toBe("Scroll to top");
  });

  it("opens no callout when focus returns without a keyboard", () => {
    startColdCalloutTimers();
    render(
      <IconButton callout="left" label="Scroll to top">
        ↑
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Scroll to top" });
    vi.spyOn(button, "matches").mockReturnValue(false);

    fireEvent.focus(button);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows no callout without the prop", () => {
    startColdCalloutTimers();
    render(<IconButton label="Copy path">×</IconButton>);
    const button = screen.getByRole("button", { name: "Copy path" });

    restPointer(button);
    focusByKeyboard(button);
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
