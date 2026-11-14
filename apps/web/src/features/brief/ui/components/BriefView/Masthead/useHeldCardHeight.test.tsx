// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CARD_MIN_PROPERTY,
  HELD_ATTRIBUTE,
  STACK_OFFSET_PROPERTY,
} from "./consts";
import { useHeldCardHeight } from "./useHeldCardHeight";

const SUMMARY_HEIGHT = 300;
const ROW_GAP = 24;
const COLLAPSED_STACK = 104;
const OPEN_STACK = 420;
const REFLOWED_STACK = 132;
const NESTED_PANEL = 48;
const RESTING_HEIGHT = SUMMARY_HEIGHT + ROW_GAP + COLLAPSED_STACK;
const CARD_OVERRUN = 72;
const TALL_CARD = RESTING_HEIGHT + CARD_OVERRUN;
const CARD_GROWTH = 40;
const GROWN_CARD = TALL_CARD + CARD_GROWTH;

let notifyResize: (() => void) | undefined;

class StubResizeObserver {
  constructor(callback: () => void) {
    notifyResize = callback;
  }
  observe(): void {}
  disconnect(): void {}
}

interface ProbeProps {
  stackHeight: number;
  barOpen: boolean;
  nestedBarOpen?: boolean;
  /** The card's rendered height; it is never shorter than its held height. */
  cardHeight?: number;
  /** The open fold's panel; by default all the stack gained by opening. */
  panelHeight?: number;
}

function Probe({
  stackHeight,
  barOpen,
  nestedBarOpen = false,
  cardHeight = RESTING_HEIGHT,
  panelHeight = barOpen ? stackHeight - COLLAPSED_STACK : 0,
}: ProbeProps) {
  const { gridRef, summaryRef, cardRef, stackRef } = useHeldCardHeight();

  return (
    <div data-testid="grid" ref={gridRef} style={{ rowGap: `${ROW_GAP}px` }}>
      <div data-height={SUMMARY_HEIGHT} ref={summaryRef} />
      <div data-height={cardHeight} ref={cardRef} />
      <div data-height={stackHeight} ref={stackRef}>
        <div>
          <section data-bar-open={barOpen ? "" : undefined}>
            <div data-bar-panel="" data-height={panelHeight}>
              <section data-bar-open={nestedBarOpen ? "" : undefined}>
                <div data-bar-panel="" data-height={NESTED_PANEL} />
              </section>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function stubMeasuredHeight(this: Element): DOMRect {
  const height = Number(this.getAttribute("data-height") ?? 0);
  return new DOMRect(0, 0, 0, height);
}

function readCardMin(): string {
  return screen.getByTestId("grid").style.getPropertyValue(CARD_MIN_PROPERTY);
}

function readStackOffset(): string {
  const grid = screen.getByTestId("grid");
  return grid.style.getPropertyValue(STACK_OFFSET_PROPERTY);
}

function isHeld(): boolean {
  return screen.getByTestId("grid").hasAttribute(HELD_ATTRIBUTE);
}

function resize(): void {
  act(() => {
    notifyResize?.();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (step: FrameRequestCallback) => {
    step(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    stubMeasuredHeight,
  );
});

afterEach(() => {
  cleanup();
  notifyResize = undefined;
});

describe("useHeldCardHeight", () => {
  it("holds the card at the summary, the gap and the closed stack", () => {
    render(<Probe barOpen={false} stackHeight={COLLAPSED_STACK} />);

    expect(readCardMin()).toBe(
      `${String(SUMMARY_HEIGHT + ROW_GAP + COLLAPSED_STACK)}px`,
    );
  });

  it("keeps the held height while a fold in the stack is open", () => {
    const { rerender } = render(
      <Probe barOpen={false} stackHeight={COLLAPSED_STACK} />,
    );

    rerender(<Probe barOpen stackHeight={OPEN_STACK} />);
    resize();

    expect(readCardMin()).toBe(
      `${String(SUMMARY_HEIGHT + ROW_GAP + COLLAPSED_STACK)}px`,
    );
  });

  it("subtracts the open panel when a fold is open at first render", () => {
    render(<Probe barOpen stackHeight={OPEN_STACK} />);

    expect(readCardMin()).toBe(`${String(RESTING_HEIGHT)}px`);
  });

  it("counts a row that grows while a fold is open", () => {
    const panelHeight = OPEN_STACK - COLLAPSED_STACK;
    const { rerender } = render(<Probe barOpen stackHeight={OPEN_STACK} />);

    rerender(
      <Probe
        barOpen
        panelHeight={panelHeight}
        stackHeight={REFLOWED_STACK + panelHeight}
      />,
    );
    resize();

    expect(readCardMin()).toBe(
      `${String(SUMMARY_HEIGHT + ROW_GAP + REFLOWED_STACK)}px`,
    );
  });

  it("measures the stack again once every fold is closed", () => {
    const { rerender } = render(<Probe barOpen stackHeight={OPEN_STACK} />);

    rerender(<Probe barOpen={false} stackHeight={REFLOWED_STACK} />);
    resize();

    expect(readCardMin()).toBe(
      `${String(SUMMARY_HEIGHT + ROW_GAP + REFLOWED_STACK)}px`,
    );
  });

  it("still measures while only a bar inside a closed fold is open", () => {
    const { rerender } = render(
      <Probe barOpen={false} stackHeight={COLLAPSED_STACK} />,
    );

    rerender(
      <Probe barOpen={false} nestedBarOpen stackHeight={REFLOWED_STACK} />,
    );
    resize();

    expect(readCardMin()).toBe(
      `${String(SUMMARY_HEIGHT + ROW_GAP + REFLOWED_STACK)}px`,
    );
  });

  it("subtracts only the panel of a row of the stack's own group", () => {
    render(<Probe barOpen nestedBarOpen stackHeight={OPEN_STACK} />);

    expect(readCardMin()).toBe(`${String(RESTING_HEIGHT)}px`);
  });

  it("ends the card with the summary when the stack is empty", () => {
    render(<Probe barOpen={false} stackHeight={0} />);

    expect(readCardMin()).toBe(`${String(SUMMARY_HEIGHT)}px`);
  });

  it("moves the stack down by what a taller card runs past it", () => {
    render(
      <Probe
        barOpen={false}
        cardHeight={TALL_CARD}
        stackHeight={COLLAPSED_STACK}
      />,
    );

    expect(readStackOffset()).toBe(`${String(CARD_OVERRUN)}px`);
  });

  it("leaves the stack under the summary when the card is no taller", () => {
    render(<Probe barOpen={false} stackHeight={COLLAPSED_STACK} />);

    expect(readStackOffset()).toBe("0px");
  });

  it("keeps the stack's offset while a fold in the stack is open", () => {
    const { rerender } = render(
      <Probe
        barOpen={false}
        cardHeight={TALL_CARD}
        stackHeight={COLLAPSED_STACK}
      />,
    );

    rerender(<Probe barOpen cardHeight={TALL_CARD} stackHeight={OPEN_STACK} />);
    resize();

    expect(readStackOffset()).toBe(`${String(CARD_OVERRUN)}px`);
  });

  it("sets the offset when a fold is open at first render", () => {
    render(<Probe barOpen cardHeight={TALL_CARD} stackHeight={OPEN_STACK} />);

    expect(readStackOffset()).toBe(`${String(CARD_OVERRUN)}px`);
  });

  it("moves the stack again when the card grows", () => {
    const { rerender } = render(
      <Probe
        barOpen={false}
        cardHeight={TALL_CARD}
        stackHeight={COLLAPSED_STACK}
      />,
    );

    rerender(
      <Probe
        barOpen={false}
        cardHeight={GROWN_CARD}
        stackHeight={COLLAPSED_STACK}
      />,
    );
    resize();

    expect(readStackOffset()).toBe(`${String(CARD_OVERRUN + CARD_GROWTH)}px`);
  });

  it("leaves the layout to the stylesheet while every fold is closed", () => {
    render(<Probe barOpen={false} stackHeight={COLLAPSED_STACK} />);

    expect(isHeld()).toBe(false);
  });

  it("holds the card from the first render when a fold is open", () => {
    render(<Probe barOpen stackHeight={OPEN_STACK} />);

    expect(isHeld()).toBe(true);
  });

  it("holds as a fold opens, without waiting for a resize", async () => {
    const { rerender } = render(
      <Probe barOpen={false} stackHeight={COLLAPSED_STACK} />,
    );

    rerender(<Probe barOpen stackHeight={OPEN_STACK} />);
    await act(async () => {});

    expect(isHeld()).toBe(true);
  });

  it("lets go once the last fold closes", async () => {
    const { rerender } = render(<Probe barOpen stackHeight={OPEN_STACK} />);

    rerender(<Probe barOpen={false} stackHeight={COLLAPSED_STACK} />);
    await act(async () => {});

    expect(isHeld()).toBe(false);
  });

  it("does not hold for a bar open inside a closed fold", () => {
    render(
      <Probe barOpen={false} nestedBarOpen stackHeight={COLLAPSED_STACK} />,
    );

    expect(isHeld()).toBe(false);
  });
});
