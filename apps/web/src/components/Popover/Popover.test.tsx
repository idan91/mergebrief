// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type * as FloatingModule from "@floating-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STICKY_STACK_HEIGHT_VAR } from "@web/utils/css-vars";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { Button } from "../Button";
import { Popover } from ".";
import { POPOVER_VIEWPORT_PADDING_PX } from "./consts";
import { PopoverFocusTargets, type PopoverFocusTarget } from "./types";

const flipPaddings = vi.hoisted((): unknown[] => []);

vi.mock("@floating-ui/react", async (importOriginal) => {
  const floating = await importOriginal<typeof FloatingModule>();
  function recordFlip(options: Parameters<typeof floating.flip>[0]) {
    return floating.flip((state) => {
      const derived = typeof options === "function" ? options(state) : options;
      const resolved = derived ?? {};
      flipPaddings.push(resolved.padding);
      return resolved;
    });
  }
  return { ...floating, flip: recordFlip };
});

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

  it("a sheet stays over the page until its scrim's click lands", async () => {
    render(
      <Popover focusOnOpen={PopoverFocusTargets.TRIGGER}>
        <Popover.Trigger>
          <Button>Open</Button>
        </Popover.Trigger>
        <Popover.Content label="Details" sheet>
          <Button>Inside</Button>
        </Popover.Content>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    await act(async () => {
      fireEvent.click(trigger);
    });
    const scrim = document.querySelector('div[aria-hidden="true"]');
    if (scrim === null) {
      throw new Error("expected the sheet's scrim");
    }

    await act(async () => {
      fireEvent.pointerDown(scrim);
      fireEvent.mouseDown(scrim);
    });
    expect(scrim.isConnected).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      fireEvent.click(scrim);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
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

describe("Popover collision padding", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(STICKY_STACK_HEIGHT_VAR);
    flipPaddings.length = 0;
  });

  it("keeps the top edge clear of the Brief page's pinned stack", async () => {
    document.documentElement.style.setProperty(
      STICKY_STACK_HEIGHT_VAR,
      "120px",
    );
    renderPopover();

    await openPopover();

    await waitFor(() => expect(flipPaddings.length).toBeGreaterThan(0));
    expect(flipPaddings.at(-1)).toMatchObject({
      top: 120 + POPOVER_VIEWPORT_PADDING_PX,
    });
  });

  it("pads only the viewport margin on a page with no pinned stack", async () => {
    renderPopover();

    await openPopover();

    await waitFor(() => expect(flipPaddings.length).toBeGreaterThan(0));
    expect(flipPaddings.at(-1)).toMatchObject({
      top: POPOVER_VIEWPORT_PADDING_PX,
    });
  });
});
