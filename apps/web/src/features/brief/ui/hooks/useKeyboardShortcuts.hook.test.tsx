// @vitest-environment jsdom
// The hook half of the C-shortcut contract: without a section to jump to
// (local path) the key is a no-op that must NOT be swallowed: the early
// return sits before preventDefault, which the pure resolver tests cannot
// reach.
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useKeyboardShortcuts,
  type KeyboardShortcutsOptions,
} from "./useKeyboardShortcuts";

function options(
  overrides: Partial<KeyboardShortcutsOptions>,
): KeyboardShortcutsOptions {
  return {
    chunkIds: ["c1"],
    groupBoundaries: [0],
    getActiveChunkId: () => null,
    disabled: false,
    sheetOpen: false,
    focusModeActive: false,
    jumpToChunk: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleHelp: vi.fn(),
    markViewed: vi.fn(),
    markViewedAvailable: true,
    ...overrides,
  };
}

function pressC(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "c", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useKeyboardShortcuts C dispatch", () => {
  it("does not swallow C while no conversation jump is wired", () => {
    renderHook(() => useKeyboardShortcuts(options({})));
    const event = pressC();
    expect(event.defaultPrevented).toBe(false);
  });

  it("consumes C and jumps when the section is wired", () => {
    const jumpToConversation = vi.fn();
    renderHook(() => useKeyboardShortcuts(options({ jumpToConversation })));
    const event = pressC();
    expect(event.defaultPrevented).toBe(true);
    expect(jumpToConversation).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardShortcuts inside an overlay", () => {
  it("leaves a key pressed inside a dialog to the dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    const toggleFocusMode = vi.fn();
    renderHook(() => useKeyboardShortcuts(options({ toggleFocusMode })));

    const event = new KeyboardEvent("keydown", {
      key: "z",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);

    expect(toggleFocusMode).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    dialog.remove();
  });

  it("an expanded disclosure button keeps the page's keys", () => {
    const toggle = document.createElement("button");
    toggle.setAttribute("aria-expanded", "true");
    document.body.append(toggle);
    const toggleFocusMode = vi.fn();
    renderHook(() => useKeyboardShortcuts(options({ toggleFocusMode })));

    toggle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(toggleFocusMode).toHaveBeenCalledTimes(1);
    toggle.remove();
  });
});

function pressS(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "s", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useKeyboardShortcuts S dispatch", () => {
  it("does not swallow S while no sidebar toggle is wired", () => {
    renderHook(() => useKeyboardShortcuts(options({})));
    const event = pressS();
    expect(event.defaultPrevented).toBe(false);
  });

  it("consumes S and toggles when the sidebar is wired", () => {
    const toggleSidebar = vi.fn();
    renderHook(() => useKeyboardShortcuts(options({ toggleSidebar })));
    const event = pressS();
    expect(event.defaultPrevented).toBe(true);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardShortcuts click-input focus", () => {
  it("V still fires with focus parked on the Viewed checkbox", () => {
    // Clicking the checkbox leaves it focused; a blanket INPUT stand-down
    // would kill every shortcut right after un-checking a chunk.
    const markViewed = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts(
        options({
          markViewed,
          focusModeActive: true,
          getActiveChunkId: () => "c1",
        }),
      ),
    );
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.append(checkbox);
    checkbox.focus();
    checkbox.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        cancelable: true,
        bubbles: true,
      }),
    );
    expect(markViewed).toHaveBeenCalledWith("c1");
    checkbox.remove();
  });

  it("reads the active chunk at keydown time, not at bind time", () => {
    // The getter exists so a position change never re-renders the host,
    // which only holds if the hook calls it per keystroke instead of
    // capturing one value when the listener binds.
    const jumpToChunk = vi.fn();
    let active: string | null = null;
    renderHook(() =>
      useKeyboardShortcuts(
        options({
          jumpToChunk,
          chunkIds: ["c1", "c2", "c3"],
          getActiveChunkId: () => active,
        }),
      ),
    );
    const pressJ = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", cancelable: true }),
      );
    pressJ();
    expect(jumpToChunk).toHaveBeenLastCalledWith("c1");
    active = "c2";
    pressJ();
    expect(jumpToChunk).toHaveBeenLastCalledWith("c3");
  });

  it("keys pressed inside an open menu stand down", () => {
    const jumpToChunk = vi.fn();
    const toggleFocusMode = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts(options({ jumpToChunk, toggleFocusMode })),
    );
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const row = document.createElement("button");
    row.setAttribute("role", "menuitem");
    menu.append(row);
    document.body.append(menu);
    row.focus();
    for (const key of ["j", "z"]) {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true }),
      );
    }
    expect(jumpToChunk).not.toHaveBeenCalled();
    expect(toggleFocusMode).not.toHaveBeenCalled();
    menu.remove();
  });

  it("keys from a text input still stand down", () => {
    const jumpToChunk = vi.fn();
    renderHook(() => useKeyboardShortcuts(options({ jumpToChunk })));
    const field = document.createElement("input");
    field.type = "text";
    document.body.append(field);
    field.focus();
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        cancelable: true,
        bubbles: true,
      }),
    );
    expect(jumpToChunk).not.toHaveBeenCalled();
    field.remove();
  });
});

function pressD(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "d", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useKeyboardShortcuts D dispatch", () => {
  it("does not swallow D while no diff view toggle is wired", () => {
    renderHook(() => useKeyboardShortcuts(options({})));
    const event = pressD();
    expect(event.defaultPrevented).toBe(false);
  });

  it("consumes D and toggles when the diff view is wired", () => {
    const toggleDiffView = vi.fn();
    renderHook(() => useKeyboardShortcuts(options({ toggleDiffView })));
    const event = pressD();
    expect(event.defaultPrevented).toBe(true);
    expect(toggleDiffView).toHaveBeenCalledTimes(1);
  });
});
