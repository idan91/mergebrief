// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { REVEAL_DELAY_MS } from "./consts";
import { FocusShortcuts } from ".";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderShortcuts() {
  render(
    <I18nProvider>
      <FocusShortcuts />
    </I18nProvider>,
  );
  return {
    corner: screen.getByTestId("focus-shortcuts"),
    trigger: screen.getByRole("button", { name: "Keys" }),
  };
}

describe("FocusShortcuts", () => {
  it("controls the shortcut list from a collapsed trigger", () => {
    const { trigger } = renderShortcuts();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(
      trigger.getAttribute("aria-controls") ?? "",
    );
    expect(list?.textContent).toContain("viewed");
  });

  it("reveals on hover only after the delay", () => {
    vi.useFakeTimers();
    const { corner, trigger } = renderShortcuts();
    fireEvent.pointerEnter(corner);
    act(() => {
      vi.advanceTimersByTime(REVEAL_DELAY_MS - 1);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("stays shut when the pointer passes by", () => {
    vi.useFakeTimers();
    const { corner, trigger } = renderShortcuts();
    fireEvent.pointerEnter(corner);
    fireEvent.pointerLeave(corner);
    act(() => {
      vi.advanceTimersByTime(REVEAL_DELAY_MS);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on keyboard focus and closes when focus leaves", () => {
    const { corner, trigger } = renderShortcuts();
    fireEvent.focus(trigger);
    expect(corner.dataset["state"]).toBe("open");
    fireEvent.blur(trigger);
    expect(corner.dataset["state"]).toBe("closed");
  });

  it("toggles from a keyboard activation of the trigger", () => {
    const { trigger } = renderShortcuts();
    fireEvent.focus(trigger);
    fireEvent.click(trigger, { detail: 0 });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger, { detail: 0 });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the list open on a pointer click", () => {
    const { trigger } = renderShortcuts();
    fireEvent.click(trigger, { detail: 1 });
    fireEvent.click(trigger, { detail: 1 });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes when a pointer lands outside the corner", () => {
    const { corner, trigger } = renderShortcuts();
    fireEvent.click(trigger, { detail: 1 });
    expect(corner.dataset["state"]).toBe("open");

    fireEvent.pointerDown(trigger);
    expect(corner.dataset["state"]).toBe("open");
    fireEvent.pointerDown(document.body);
    expect(corner.dataset["state"]).toBe("closed");
  });
});
