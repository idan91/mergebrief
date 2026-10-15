// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARD_MIN_PROPERTY } from "./consts";
import { useHeldCardHeight } from "./useHeldCardHeight";

const SUMMARY_HEIGHT = 300;
const ROW_GAP = 24;
const COLLAPSED_STACK = 104;
const OPEN_STACK = 420;

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
}

function Probe({ stackHeight, barOpen }: ProbeProps) {
  const { gridRef, summaryRef, stackRef } = useHeldCardHeight();

  return (
    <div data-testid="grid" ref={gridRef} style={{ rowGap: `${ROW_GAP}px` }}>
      <div data-height={SUMMARY_HEIGHT} ref={summaryRef} />
      <div data-height={stackHeight} ref={stackRef}>
        <section data-bar-open={barOpen ? "" : undefined} />
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

  it("keeps the held height while a bar in the stack is open", () => {
    const { rerender } = render(
      <Probe barOpen={false} stackHeight={COLLAPSED_STACK} />,
    );

    rerender(<Probe barOpen stackHeight={OPEN_STACK} />);
    resize();

    expect(readCardMin()).toBe(
      `${String(SUMMARY_HEIGHT + ROW_GAP + COLLAPSED_STACK)}px`,
    );
  });

  it("measures the stack again once every bar is closed", () => {
    const { rerender } = render(<Probe barOpen stackHeight={OPEN_STACK} />);
    expect(readCardMin()).toBe("");

    rerender(<Probe barOpen={false} stackHeight={COLLAPSED_STACK} />);
    resize();

    expect(readCardMin()).toBe(
      `${String(SUMMARY_HEIGHT + ROW_GAP + COLLAPSED_STACK)}px`,
    );
  });

  it("ends the card with the summary when the stack is empty", () => {
    render(<Probe barOpen={false} stackHeight={0} />);

    expect(readCardMin()).toBe(`${String(SUMMARY_HEIGHT)}px`);
  });
});
