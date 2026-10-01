// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import type { SidebarLayout } from "../../utils";
import { StorySplitter } from ".";
import { STORY_DRAG_ATTR } from "./consts";
import { StackedQueries } from "./types";

interface ResizeEntryStub {
  target: Element;
  contentRect: { width: number };
  borderBoxSize: { inlineSize: number }[];
}

type ResizeCallback = (entries: ResizeEntryStub[]) => void;

let observeCallback: ResizeCallback | undefined;
const observed: Element[] = [];

class StubResizeObserver {
  constructor(callback: ResizeCallback) {
    observeCallback = callback;
  }
  observe(target: Element): void {
    observed.push(target);
  }
  disconnect(): void {}
}

afterEach(() => {
  cleanup();
  observeCallback = undefined;
  observed.length = 0;
  resetMediaQueries();
  vi.unstubAllGlobals();
});

interface HarnessProps {
  sidebar?: SidebarLayout | undefined;
  direction?: "ltr" | "rtl";
  setTrack?: (px: number) => void;
  resetTrack?: () => void;
}

function stubHarness({
  sidebar,
  direction = "ltr",
  setTrack = () => {},
  resetTrack = () => {},
}: HarnessProps = {}) {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  render(
    <main className="main" dir={direction}>
      <section className="story-group" data-testid="group">
        <div className="group-chunks" data-testid="chunks" />
        <StorySplitter
          sidebar={sidebar}
          cardId="group-1-card"
          setTrack={setTrack}
          resetTrack={resetTrack}
        />
        <article data-testid="card" id="group-1-card" />
      </section>
    </main>,
  );
}

function stubEntry(target: Element, width: number): ResizeEntryStub {
  return {
    target,
    contentRect: { width: width - 2 },
    borderBoxSize: [{ inlineSize: width }],
  };
}

const GAP = 18;

function measure(columnWidth: number, cardWidth: number): void {
  const group = screen.getByTestId("group");
  const chunks = screen.getByTestId("chunks");
  const card = screen.getByTestId("card");
  act(() => {
    observeCallback?.([
      stubEntry(group, columnWidth),
      stubEntry(chunks, columnWidth - cardWidth - GAP),
      stubEntry(card, cardWidth),
    ]);
  });
}

function readMainTrack(): string {
  return screen.getByRole("main").style.getPropertyValue("--story-card-track");
}

describe("StorySplitter", () => {
  it("is a vertical separator naming both panes", () => {
    stubHarness();
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-label")).toBe(
      "Resize the change-group column beside the diffs",
    );
    expect(separator.getAttribute("tabindex")).toBe("0");
    expect(separator.getAttribute("aria-controls")).toBe("group-1-card");
  });

  it("carries no value until the first measurement", () => {
    stubHarness();
    const separator = screen.getByRole("separator");

    expect(separator.hasAttribute("aria-valuenow")).toBe(false);
    expect(separator.hasAttribute("aria-valuemax")).toBe(false);
    expect(separator.hasAttribute("aria-valuetext")).toBe(false);
    expect(separator.hasAttribute("tabindex")).toBe(false);
  });

  it("reports the floor, the measured ceiling and the card width", () => {
    stubHarness();
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    expect(separator.getAttribute("aria-valuemin")).toBe("360");
    expect(separator.getAttribute("aria-valuemax")).toBe("750");
    expect(separator.getAttribute("aria-valuenow")).toBe("450");
    expect(separator.getAttribute("aria-valuetext")).toBe(
      "Change-group column 450 pixels wide",
    );
  });

  it("caps the ceiling by the column on a narrow layout", () => {
    stubHarness();
    measure(1100, 450);

    expect(screen.getByRole("separator").getAttribute("aria-valuemax")).toBe(
      "580",
    );
  });

  it("observes the group, the diff column and the card", () => {
    stubHarness();

    expect(observed).toEqual([
      screen.getByTestId("group"),
      screen.getByTestId("chunks"),
      screen.getByTestId("card"),
    ]);
  });

  it("commits one step wider on ArrowLeft", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1400, 450);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });

    expect(setTrack).toHaveBeenCalledWith(466);
  });

  it("steps from the last commit when keys repeat before a measure", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1400, 450);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });

    expect(setTrack.mock.calls).toEqual([[466], [482]]);
  });

  it("commits the floor on Home and the ceiling on End", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1100, 450);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Home" });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });

    expect(setTrack.mock.calls).toEqual([[360], [580]]);
  });

  it("writes the variable during a drag and commits once on release", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 960, pointerId: 1 });
    expect(readMainTrack()).toBe("490px");
    expect(setTrack).not.toHaveBeenCalled();

    fireEvent.pointerMove(separator, { clientX: 940, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 940, pointerId: 1 });
    expect(setTrack.mock.calls).toEqual([[510]]);
  });

  it("holds the observed width until the drag releases", () => {
    stubHarness();
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    measure(1400, 500);
    expect(separator.getAttribute("aria-valuenow")).toBe("450");

    fireEvent.pointerUp(separator, { clientX: 950, pointerId: 1 });
    expect(separator.getAttribute("aria-valuenow")).toBe("500");
  });

  it("holds every other handle too until the drag releases", async () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    render(
      <main className="main">
        <section className="story-group" data-testid="group">
          <div className="group-chunks" />
          <StorySplitter
            sidebar={undefined}
            cardId="card-1"
            setTrack={() => {}}
            resetTrack={() => {}}
          />
          <article data-testid="card" id="card-1" />
        </section>
        <section className="story-group" data-testid="group-2">
          <div className="group-chunks" />
          <StorySplitter
            sidebar={undefined}
            cardId="card-2"
            setTrack={() => {}}
            resetTrack={() => {}}
          />
          <article data-testid="card-2" id="card-2" />
        </section>
      </main>,
    );
    const [first, second] = screen.getAllByRole("separator");
    const secondCard = screen.getByTestId("card-2");
    const secondGroup = screen.getByTestId("group-2");
    const observeSecond = (width: number) =>
      act(() =>
        observeCallback?.([
          stubEntry(secondGroup, 1400),
          stubEntry(secondCard, width),
        ]),
      );
    observeSecond(450);
    expect(second?.getAttribute("aria-valuenow")).toBe("450");

    fireEvent.pointerDown(first as Element, { clientX: 1000, pointerId: 1 });
    observeSecond(500);
    expect(second?.getAttribute("aria-valuenow")).toBe("450");

    fireEvent.pointerUp(first as Element, { clientX: 950, pointerId: 1 });
    await act(async () => {});
    expect(second?.getAttribute("aria-valuenow")).toBe("500");
  });

  it("commits nothing on a press without movement", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 1000, pointerId: 1 });

    expect(setTrack).not.toHaveBeenCalled();
    expect(screen.getByRole("main").hasAttribute(STORY_DRAG_ATTR)).toBe(false);
  });

  it("commits nothing when the pointer jitters under the slop", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 1001, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 1001, pointerId: 1 });

    expect(setTrack).not.toHaveBeenCalled();
    expect(readMainTrack()).toBe("");
  });

  it("moves focus to the handle on pointer down", () => {
    stubHarness();
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });

    expect(document.activeElement).toBe(separator);
  });

  it("ends a drag the unmount interrupts", () => {
    stubHarness();
    measure(1400, 450);
    const separator = screen.getByRole("separator");
    const main = screen.getByRole("main");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 900, pointerId: 1 });
    act(() => setMediaQueryMatches(StackedQueries.BARE, true));

    expect(main.hasAttribute(STORY_DRAG_ATTR)).toBe(false);
    expect(main.style.getPropertyValue("--story-card-track")).toBe("");
  });

  it("clamps the committed width on release", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 200, pointerId: 1 });

    expect(setTrack).toHaveBeenCalledWith(750);
  });

  it("follows the inline axis under rtl", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack, direction: "rtl" });
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 1040, pointerId: 1 });
    fireEvent.pointerUp(separator, { clientX: 1040, pointerId: 1 });

    expect(setTrack).toHaveBeenCalledWith(490);
  });

  it("marks the main region while dragging", () => {
    stubHarness();
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    expect(screen.getByRole("main").hasAttribute(STORY_DRAG_ATTR)).toBe(true);

    fireEvent.pointerUp(separator, { clientX: 1000, pointerId: 1 });
    expect(screen.getByRole("main").hasAttribute(STORY_DRAG_ATTR)).toBe(false);
  });

  it("restores the width when a drag is cancelled", () => {
    const setTrack = vi.fn();
    stubHarness({ setTrack });
    measure(1400, 450);
    const separator = screen.getByRole("separator");

    fireEvent.pointerDown(separator, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 900, pointerId: 1 });
    fireEvent.pointerCancel(separator, { pointerId: 1 });

    expect(readMainTrack()).toBe("");
    expect(setTrack).not.toHaveBeenCalled();
  });

  it("resets on double-click", () => {
    const resetTrack = vi.fn();
    stubHarness({ resetTrack });
    fireEvent.doubleClick(screen.getByRole("separator"));

    expect(resetTrack).toHaveBeenCalledOnce();
  });

  it("does not mount under the bare stacked width", () => {
    setMediaQueryMatches(StackedQueries.BARE, true);
    stubHarness();

    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("keys the stacked width on the sidebar layout", () => {
    setMediaQueryMatches(StackedQueries.SIDEBAR_EXPANDED, true);
    stubHarness({ sidebar: "collapsed" });
    expect(screen.getByRole("separator")).toBeTruthy();
    cleanup();

    stubHarness({ sidebar: "expanded" });
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("unmounts when the viewport stacks after mount", () => {
    stubHarness();
    expect(screen.getByRole("separator")).toBeTruthy();

    act(() => setMediaQueryMatches(StackedQueries.BARE, true));
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
