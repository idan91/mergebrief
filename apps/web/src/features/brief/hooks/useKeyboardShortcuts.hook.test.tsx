// @vitest-environment jsdom
// The hook half of the C-shortcut contract: without a section to jump to
// (local path) the key is a no-op that must NOT be swallowed — the early
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
    activeChunkId: null,
    disabled: false,
    focusModeActive: false,
    jumpToChunk: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleHelp: vi.fn(),
    ...overrides,
  };
}

function pressC(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "c", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useKeyboardShortcuts — C dispatch", () => {
  it("does not swallow C on the local path (no jumpToConversation wired)", () => {
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
