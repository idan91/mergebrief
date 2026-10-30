// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  crossesFocusBoundary,
  isInsideCallout,
  setContentTabStop,
} from "./utils";

afterEach(() => {
  document.body.replaceChildren();
});

describe("isInsideCallout", () => {
  it("is true for a node inside a callout root and false outside one", () => {
    const callout = document.createElement("span");
    callout.setAttribute("data-callout", "");
    const inner = document.createElement("span");
    callout.append(inner);
    const outside = document.createElement("span");
    document.body.append(callout, outside);

    expect(isInsideCallout(inner)).toBe(true);
    expect(isInsideCallout(callout)).toBe(true);
    expect(isInsideCallout(outside)).toBe(false);
    expect(isInsideCallout(document)).toBe(false);
    expect(isInsideCallout(null)).toBe(false);
  });
});

describe("setContentTabStop", () => {
  it("adds and drops the tab stop on a live scroller", () => {
    const content = document.createElement("span");

    setContentTabStop(content, { tabStop: true, portalParked: false });
    expect(content.getAttribute("tabindex")).toBe("0");
    setContentTabStop(content, { tabStop: false, portalParked: false });
    expect(content.hasAttribute("tabindex")).toBe(false);
  });

  it("writes a parked scroller's change into its parked value", () => {
    const content = document.createElement("span");
    content.setAttribute("tabindex", "-1");
    content.setAttribute("data-tabindex", "0");

    setContentTabStop(content, { tabStop: false, portalParked: true });
    expect(content.getAttribute("tabindex")).toBe("-1");
    expect(content.getAttribute("data-tabindex")).toBe("");

    setContentTabStop(content, { tabStop: true, portalParked: true });
    expect(content.getAttribute("data-tabindex")).toBe("0");
  });

  it("parks a stop gained while the portal is parked", () => {
    const content = document.createElement("span");

    setContentTabStop(content, { tabStop: true, portalParked: true });
    expect(content.getAttribute("tabindex")).toBe("-1");
    expect(content.getAttribute("data-tabindex")).toBe("0");
  });
});

describe("crossesFocusBoundary", () => {
  it("is true only when focus moves across the container's edge", () => {
    const container = document.createElement("div");
    const inner = document.createElement("button");
    container.append(inner);
    const outside = document.createElement("button");
    document.body.append(container, outside);

    function crossesFrom(other: Element | null): boolean {
      return crossesFocusBoundary(
        container,
        new FocusEvent("focusout", { relatedTarget: other }),
      );
    }
    expect(crossesFrom(outside)).toBe(true);
    expect(crossesFrom(null)).toBe(true);
    expect(crossesFrom(inner)).toBe(false);
  });
});
