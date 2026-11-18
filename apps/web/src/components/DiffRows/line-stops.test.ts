// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findLineStep,
  findRowStop,
  readLineStop,
  REVEAL_FRAME_BUDGET,
  revealLineStop,
  syncTabStop,
} from "./line-stops";

function mountBody(markup: string): HTMLTableSectionElement {
  const table = document.createElement("table");
  table.innerHTML = `<tbody>${markup}</tbody>`;
  const body = table.tBodies[0];
  if (body === undefined) {
    throw new Error("no table body");
  }
  return body;
}

function listTabIndexes(body: HTMLElement): number[] {
  const stops = body.querySelectorAll<HTMLElement>("[data-line-stop]");
  return [...stops].map((stop) => stop.tabIndex);
}

const SPLIT_ROWS = `
  <tr>
    <td id="l1" data-line-stop="left-arrow" tabindex="-1"></td>
    <td id="r1" data-line-stop="right" tabindex="-1"></td>
  </tr>
  <tr>
    <td id="l2" data-line-stop="left" tabindex="-1"></td>
    <td id="r2" data-line-stop="right" tabindex="-1"></td>
  </tr>`;

const UNIFIED_ROWS = `
  <tr id="u1" data-line-stop="row" tabindex="-1"></tr>
  <tr id="u2" data-line-stop="row" tabindex="-1"></tr>`;

describe("syncTabStop", () => {
  it("opens the first tab stop and passes over an arrow-only one", () => {
    const body = mountBody(SPLIT_ROWS);

    const tabStop = syncTabStop(body, undefined);

    expect(tabStop?.id).toBe("r1");
    expect(listTabIndexes(body)).toEqual([-1, 0, -1, -1]);
  });

  it("holds an arrow-only stop the reader moved to", () => {
    const body = mountBody(SPLIT_ROWS);
    const moved = body.querySelector<HTMLElement>("#l1") ?? undefined;

    const tabStop = syncTabStop(body, moved);

    expect(tabStop?.id).toBe("l1");
    expect(listTabIndexes(body)).toEqual([0, -1, -1, -1]);
  });

  it("falls back to the first tab stop once the held line has left", () => {
    const body = mountBody(SPLIT_ROWS);
    const gone = document.createElement("td");

    expect(syncTabStop(body, gone)?.id).toBe("r1");
  });

  it("answers nothing for a table with no stops", () => {
    const body = mountBody("<tr><td></td></tr>");

    expect(syncTabStop(body, undefined)).toBeUndefined();
  });
});

describe("findLineStep", () => {
  it("steps within the side it started on", () => {
    const body = mountBody(SPLIT_ROWS);
    const from = body.querySelector<HTMLElement>("#l1");
    if (from === null) {
      throw new Error("no start cell");
    }

    expect(findLineStep(body, from, "ArrowDown")?.id).toBe("l2");
    expect(findLineStep(body, from, "End")?.id).toBe("l2");
    expect(findLineStep(body, from, "ArrowUp")).toBeUndefined();
    expect(findLineStep(body, from, "Enter")).toBeUndefined();
  });

  it("steps from an arrow-only cell onto a tab stop of its column", () => {
    const body = mountBody(SPLIT_ROWS);
    const from = body.querySelector<HTMLElement>("#l2");
    if (from === null) {
      throw new Error("no start cell");
    }

    expect(findLineStep(body, from, "ArrowUp")?.id).toBe("l1");
    expect(findLineStep(body, from, "Home")?.id).toBe("l1");
  });

  it("steps through a unified table as one column", () => {
    const body = mountBody(UNIFIED_ROWS);
    const from = body.querySelector<HTMLElement>("#u1");
    if (from === null) {
      throw new Error("no start row");
    }

    expect(findLineStep(body, from, "ArrowDown")?.id).toBe("u2");
  });
});

describe("findRowStop", () => {
  it("finds the other column's stop on the same row", () => {
    const body = mountBody(SPLIT_ROWS);
    const from = body.querySelector<HTMLElement>("#l2") ?? undefined;
    if (from === undefined) {
      throw new Error("no stop");
    }

    expect(findRowStop(from, "right")?.id).toBe("r2");
    expect(findRowStop(from, "left")?.id).toBe("l2");
  });

  it("answers nothing when the row has no stop in that column", () => {
    const body = mountBody(`
      <tr>
        <td id="only" data-line-stop="left" tabindex="-1"></td>
        <td data-side="right"></td>
      </tr>`);
    const from = body.querySelector<HTMLElement>("#only") ?? undefined;
    if (from === undefined) {
      throw new Error("no stop");
    }

    expect(findRowStop(from, "right")).toBeUndefined();
  });

  it("passes over a stop nested inside a cell of the row", () => {
    const body = mountBody(`
      <tr>
        <td id="outer" data-line-stop="left" tabindex="-1">
          <table><tbody><tr>
            <td data-line-stop="right" tabindex="-1"></td>
          </tr></tbody></table>
        </td>
      </tr>`);
    const from = body.querySelector<HTMLElement>("#outer") ?? undefined;
    if (from === undefined) {
      throw new Error("no stop");
    }

    expect(findRowStop(from, "right")).toBeUndefined();
  });
});

describe("readLineStop", () => {
  it("takes a line and refuses a control inside one", () => {
    const body = mountBody(
      '<tr data-line-stop="row"><td><button></button></td></tr>',
    );
    const line = body.querySelector("tr");

    expect(readLineStop(line)?.tagName).toBe("TR");
    expect(readLineStop(body.querySelector("button"))).toBeUndefined();
    expect(readLineStop(null)).toBeUndefined();
  });
});

describe("revealLineStop", () => {
  const MORE_FRAMES_THAN_THE_BUDGET = REVEAL_FRAME_BUDGET * 3;

  function mountStops() {
    const body = mountBody(
      '<tr id="a" data-line-stop="row" tabindex="0"></tr>' +
        '<tr id="b" data-line-stop="row" tabindex="-1"></tr>',
    );
    document.body.append(body.parentElement ?? body);
    const [first, second] = body.querySelectorAll<HTMLElement>("tr");
    if (first === undefined || second === undefined) {
      throw new Error("no line stops");
    }
    const firstScroll = vi.fn();
    const secondScroll = vi.fn();
    first.scrollIntoView = firstScroll;
    second.scrollIntoView = secondScroll;
    return { first, second, firstScroll, secondScroll };
  }

  function runFrames(count: number): void {
    for (let frame = 0; frame < count; frame += 1) {
      vi.advanceTimersToNextFrame();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    });
  });

  afterEach(() => {
    // A reveal still repeating belongs to the test that started it.
    window.dispatchEvent(new Event("wheel"));
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("scrolls a focused line again on the next frame", () => {
    const { first, firstScroll } = mountStops();
    first.focus();

    revealLineStop(first);
    expect(firstScroll).toHaveBeenCalledTimes(1);
    runFrames(1);

    expect(firstScroll).toHaveBeenCalledTimes(2);
  });

  it("stops repeating once its frames are spent", () => {
    const { first, firstScroll } = mountStops();
    first.focus();

    revealLineStop(first);
    runFrames(MORE_FRAMES_THAN_THE_BUDGET);

    expect(firstScroll).toHaveBeenCalledTimes(1 + REVEAL_FRAME_BUDGET);
  });

  it("stops repeating once focus has left the line", () => {
    const { first, second, firstScroll } = mountStops();
    first.focus();

    revealLineStop(first);
    second.focus();
    runFrames(MORE_FRAMES_THAN_THE_BUDGET);

    expect(firstScroll).toHaveBeenCalledTimes(1);
  });

  it("hands the frames to a newer reveal", () => {
    const { first, second, firstScroll, secondScroll } = mountStops();
    first.focus();
    revealLineStop(first);
    second.focus();

    revealLineStop(second);
    runFrames(1);

    expect(firstScroll).toHaveBeenCalledTimes(1);
    expect(secondScroll).toHaveBeenCalledTimes(2);
  });

  it.each(["wheel", "touchstart", "keydown", "pointerdown"])(
    "stops repeating once the reader sends a %s",
    (type) => {
      const { first, firstScroll } = mountStops();
      first.focus();

      revealLineStop(first);
      runFrames(1);
      window.dispatchEvent(new Event(type));
      runFrames(MORE_FRAMES_THAN_THE_BUDGET);

      expect(firstScroll).toHaveBeenCalledTimes(2);
    },
  );

  it("repeats again for a step taken after the reader's input", () => {
    const { first, firstScroll } = mountStops();
    first.focus();
    revealLineStop(first);
    window.dispatchEvent(new Event("wheel"));

    revealLineStop(first);
    runFrames(1);

    expect(firstScroll).toHaveBeenCalledTimes(3);
  });

  it("removes each input listener as it was added once its frames are spent", () => {
    const { first } = mountStops();
    first.focus();
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");

    revealLineStop(first);
    runFrames(MORE_FRAMES_THAN_THE_BUDGET);

    expect(addListener.mock.calls.length).toBeGreaterThan(0);
    expect(removeListener.mock.calls).toEqual(addListener.mock.calls);
    addListener.mockRestore();
    removeListener.mockRestore();
  });

  it("carries the stepping mark only while it scrolls", () => {
    const { first, firstScroll } = mountStops();
    first.focus();
    const marks: (string | undefined)[] = [];
    firstScroll.mockImplementation(() => {
      marks.push(first.dataset["state"]);
    });

    revealLineStop(first);
    runFrames(1);

    expect(marks).toEqual(["stepping", "stepping"]);
    expect(first.dataset["state"]).toBeUndefined();
  });
});
