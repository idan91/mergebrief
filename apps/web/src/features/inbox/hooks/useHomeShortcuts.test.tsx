// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { writeSingleKeyShortcutsOn } from "@web/utils/single-key-shortcuts";
import { useHomeShortcuts } from "./useHomeShortcuts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  writeSingleKeyShortcutsOn(true);
});

function pressQuestionMark(target: EventTarget = window): boolean {
  const event = new KeyboardEvent("keydown", {
    key: "?",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useHomeShortcuts", () => {
  it("toggles on ? from the page and closes on ? from the dialog", () => {
    const { result } = renderHook(() => useHomeShortcuts(true));
    expect(result.current.isOpen).toBe(false);

    act(() => {
      pressQuestionMark();
    });
    expect(result.current.isOpen).toBe(true);

    document.body.innerHTML =
      '<div role="dialog"><button id="in"></button></div>';
    act(() => {
      pressQuestionMark(document.getElementById("in") ?? window);
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("leaves ? to a field and to another open menu", () => {
    const { result } = renderHook(() => useHomeShortcuts(true));
    document.body.innerHTML =
      '<input id="field" /><div role="menu"><span id="row"></span></div>';

    act(() => {
      pressQuestionMark(document.getElementById("field") ?? window);
    });
    act(() => {
      pressQuestionMark(document.getElementById("row") ?? window);
    });

    expect(result.current.isOpen).toBe(false);
  });

  it("disabled, it listens to nothing and leaves the key alone", () => {
    const { result } = renderHook(() => useHomeShortcuts(false));
    let swallowed = true;
    act(() => {
      swallowed = pressQuestionMark();
    });
    expect(swallowed).toBe(false);
    expect(result.current.isOpen).toBe(false);
  });

  it("disabling closes it, so it does not reopen on its own later", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useHomeShortcuts(enabled),
      { initialProps: { enabled: true } },
    );
    act(() => {
      pressQuestionMark();
    });
    expect(result.current.isOpen).toBe(true);

    rerender({ enabled: false });
    expect(result.current.isOpen).toBe(false);
    rerender({ enabled: true });
    expect(result.current.isOpen).toBe(false);
  });
});

describe("useHomeShortcuts with single-key shortcuts off", () => {
  it("leaves ? alone, and the dialog still opens when asked", () => {
    writeSingleKeyShortcutsOn(false);
    const { result } = renderHook(() => useHomeShortcuts(true));

    let prevented = true;
    act(() => {
      prevented = pressQuestionMark();
    });
    const openAfterKey = result.current.isOpen;
    act(() => {
      result.current.open();
    });

    expect(prevented).toBe(false);
    expect(openAfterKey).toBe(false);
    expect(result.current.isOpen).toBe(true);
  });
});
