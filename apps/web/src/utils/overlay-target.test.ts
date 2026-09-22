// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { isInsideOverlay } from "./overlay-target";

describe("isInsideOverlay", () => {
  it("is true inside a dialog, a menu or an expanded control", () => {
    document.body.innerHTML = `
      <div role="dialog"><button id="in-dialog"></button></div>
      <div role="menu"><span id="in-menu"></span></div>
      <button aria-expanded="true" id="expanded"></button>
      <p id="page"></p>`;
    expect(isInsideOverlay(document.getElementById("in-dialog"))).toBe(true);
    expect(isInsideOverlay(document.getElementById("in-menu"))).toBe(true);
    expect(isInsideOverlay(document.getElementById("expanded"))).toBe(true);
    expect(isInsideOverlay(document.getElementById("page"))).toBe(false);
    expect(isInsideOverlay(null)).toBe(false);
  });
});
