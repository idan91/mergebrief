// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLargeTitleOut } from "./useLargeTitleOut";

const BAR_HEIGHT = 60;

interface StubEntry {
  rootBounds: { top: number };
  boundingClientRect: { bottom: number; height: number };
}

let notifyIntersection: ((entries: StubEntry[]) => void) | undefined;

class StubIntersectionObserver {
  constructor(callback: (entries: StubEntry[]) => void) {
    notifyIntersection = callback;
  }
  observe(): void {}
  disconnect(): void {}
}

interface ProbeProps {
  withBlock: boolean;
}

function Probe({ withBlock }: ProbeProps) {
  const [block, attachBlock] = useState<HTMLDivElement | null>(null);
  const out = useLargeTitleOut(BAR_HEIGHT, block);

  return (
    <>
      {withBlock ? <div ref={attachBlock} /> : null}
      <output>{out ? "out" : "in"}</output>
    </>
  );
}

function scrollBlockTo(bottom: number, height: number): void {
  act(() => {
    notifyIntersection?.([
      {
        rootBounds: { top: BAR_HEIGHT },
        boundingClientRect: { bottom, height },
      },
    ]);
  });
}

function readTitleOut(): string | null {
  return screen.getByRole("status").textContent;
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});

afterEach(() => {
  cleanup();
  notifyIntersection = undefined;
});

describe("useLargeTitleOut", () => {
  it("hands the title to the bar when no block is mounted", () => {
    render(<Probe withBlock={false} />);

    expect(readTitleOut()).toBe("out");
  });

  it("keeps the title in the block while it shows below the bar", () => {
    render(<Probe withBlock />);

    scrollBlockTo(BAR_HEIGHT + 120, 100);

    expect(readTitleOut()).toBe("in");
  });

  it("hands the title to the bar once the block is under it", () => {
    render(<Probe withBlock />);

    scrollBlockTo(BAR_HEIGHT - 4, 100);

    expect(readTitleOut()).toBe("out");
  });

  it("never counts a block the layout hides as out", () => {
    render(<Probe withBlock />);

    scrollBlockTo(0, 0);

    expect(readTitleOut()).toBe("in");
  });

  it("follows the block when it unmounts and mounts again", () => {
    const { rerender } = render(<Probe withBlock />);
    scrollBlockTo(BAR_HEIGHT + 120, 100);

    rerender(<Probe withBlock={false} />);
    expect(readTitleOut()).toBe("out");

    rerender(<Probe withBlock />);
    scrollBlockTo(BAR_HEIGHT + 120, 100);
    expect(readTitleOut()).toBe("in");
  });
});
