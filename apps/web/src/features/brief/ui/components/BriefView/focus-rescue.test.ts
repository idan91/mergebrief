// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { focusRescueTarget } from "./focus-rescue";

function mountButton(terminalSlot: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  if (terminalSlot) {
    button.setAttribute("data-terminal-slot", "");
  }
  document.body.append(button);
  return button;
}

describe("focusRescueTarget", () => {
  afterEach(() => {
    resetMediaQueries();
    document.body.replaceChildren();
  });

  it("lands on the terminal-slot CTA on a wide screen", () => {
    const controls = mountButton(false);
    const terminalSlot = mountButton(true);

    focusRescueTarget({ current: controls });

    expect(document.activeElement).toBe(terminalSlot);
  });

  it("lands on Brief controls on a phone", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    const controls = mountButton(false);
    mountButton(true);

    focusRescueTarget({ current: controls });

    expect(document.activeElement).toBe(controls);
  });

  it("falls back to the terminal slot on a phone with no controls", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    const terminalSlot = mountButton(true);

    focusRescueTarget({ current: null });

    expect(document.activeElement).toBe(terminalSlot);
  });
});
