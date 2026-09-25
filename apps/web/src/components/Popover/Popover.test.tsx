// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { Button } from "../Button";
import { Popover } from ".";
import { PopoverFocusTargets, type PopoverFocusTarget } from "./types";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches(REDUCED_MOTION, true);
});

function renderPopover(
  focusOnOpen: PopoverFocusTarget = PopoverFocusTargets.TRIGGER,
  portal = true,
) {
  return render(
    <div>
      <Button variant="secondary">Before</Button>
      <Popover focusOnOpen={focusOnOpen} portal={portal}>
        <Popover.Trigger>
          <Button variant="secondary">Open</Button>
        </Popover.Trigger>
        <Popover.Content label="Details">
          <Button variant="secondary">Inside</Button>
        </Popover.Content>
      </Popover>
    </div>,
  );
}

async function openPopover(): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  await act(async () => {
    fireEvent.click(trigger);
  });
  return trigger;
}

describe("Popover", () => {
  it("opens on click and the trigger reports the expanded panel", async () => {
    renderPopover();
    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Details")).toBeNull();

    await openPopover();

    const panel = screen.getByLabelText("Details");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("keeps focus on the trigger by default and moves it in on request", async () => {
    renderPopover();
    const trigger = await openPopover();
    expect(document.activeElement).toBe(trigger);
    cleanup();

    renderPopover(PopoverFocusTargets.CONTENT);
    await openPopover();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Inside" }),
      ),
    );
  });

  it("Escape from inside closes it and focus returns to the trigger", async () => {
    const bubbleListener = vi.fn();
    document.addEventListener("keydown", bubbleListener);
    renderPopover();
    const trigger = await openPopover();
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();

    await act(async () => {
      fireEvent.keyDown(inside, { key: "Escape" });
    });

    expect(screen.queryByLabelText("Details")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(bubbleListener).not.toHaveBeenCalled();
    document.removeEventListener("keydown", bubbleListener);
  });

  it("an outside press closes it and leaves focus where it went", async () => {
    renderPopover();
    await openPopover();
    const before = screen.getByRole("button", { name: "Before" });

    await act(async () => {
      before.focus();
      fireEvent.pointerDown(before);
      fireEvent.mouseDown(before);
    });

    expect(screen.queryByLabelText("Details")).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("a press inside the panel keeps it open", async () => {
    renderPopover();
    await openPopover();

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Inside" }));
    });

    expect(screen.getByLabelText("Details")).toBeTruthy();
  });

  it("renders in the tree beside the trigger when portal is off", async () => {
    renderPopover(PopoverFocusTargets.TRIGGER, false);
    const trigger = await openPopover();

    const panel = screen.getByLabelText("Details");
    expect(panel.parentElement).toBe(trigger.parentElement);
  });

  it("under reduced motion the panel leaves in the same commit", async () => {
    renderPopover();
    const trigger = await openPopover();
    expect(screen.getByLabelText("Details").style.transitionDuration).not.toBe(
      "180ms",
    );

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Escape" });
    });

    expect(screen.queryByLabelText("Details")).toBeNull();
  });

  it("at default motion the closing panel is inert until its exit ends", async () => {
    setMediaQueryMatches(REDUCED_MOTION, false);
    renderPopover();
    const trigger = await openPopover();
    await waitFor(() =>
      expect(screen.getByLabelText("Details").style.transitionDuration).toBe(
        "180ms",
      ),
    );

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Escape" });
    });

    const closing = screen.getByLabelText("Details");
    expect(closing.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(screen.queryByLabelText("Details")).toBeNull());
  });
});
