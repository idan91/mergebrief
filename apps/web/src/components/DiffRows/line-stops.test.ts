// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  findLineStep,
  findRowStop,
  readLineStop,
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
