// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSuppressedSingleKey,
  readSingleKeyShortcutsOn,
  SINGLE_KEY_SHORTCUTS_STORAGE_KEY,
  subscribeSingleKeyShortcuts,
  writeSingleKeyShortcutsOn,
} from "./single-key-shortcuts";

const NO_MODIFIERS = { metaKey: false, ctrlKey: false, altKey: false };

afterEach(() => {
  vi.restoreAllMocks();
  writeSingleKeyShortcutsOn(true);
  window.localStorage.clear();
});

describe("the single-key shortcut preference", () => {
  it("is on until the reader turns it off", () => {
    expect(readSingleKeyShortcutsOn()).toBe(true);
  });

  it("stays off across a read once turned off", () => {
    writeSingleKeyShortcutsOn(false);

    expect(readSingleKeyShortcutsOn()).toBe(false);
    expect(window.localStorage.getItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY)).toBe(
      "false",
    );
  });

  it("reads a stored value it cannot parse as on", () => {
    window.localStorage.setItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY, '"nope"');

    expect(readSingleKeyShortcutsOn()).toBe(true);
  });

  it("keeps the choice for the page when storage is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => writeSingleKeyShortcutsOn(false)).not.toThrow();
    expect(readSingleKeyShortcutsOn()).toBe(false);
    expect(isSuppressedSingleKey({ key: "j", ...NO_MODIFIERS })).toBe(true);
  });

  it("tells a subscriber about a change, until it leaves", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSingleKeyShortcuts(onChange);

    writeSingleKeyShortcutsOn(false);
    unsubscribe();
    writeSingleKeyShortcutsOn(true);

    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe("isSuppressedSingleKey", () => {
  it("lets every key through while the preference is on", () => {
    expect(isSuppressedSingleKey({ key: "j", ...NO_MODIFIERS })).toBe(false);
  });

  it("stops a letter, a capital and a symbol pressed alone", () => {
    writeSingleKeyShortcutsOn(false);

    expect(isSuppressedSingleKey({ key: "j", ...NO_MODIFIERS })).toBe(true);
    expect(isSuppressedSingleKey({ key: "J", ...NO_MODIFIERS })).toBe(true);
    expect(isSuppressedSingleKey({ key: "?", ...NO_MODIFIERS })).toBe(true);
  });

  it("lets a named key, Space and a modified key through", () => {
    writeSingleKeyShortcutsOn(false);

    expect(isSuppressedSingleKey({ key: "Escape", ...NO_MODIFIERS })).toBe(
      false,
    );
    expect(isSuppressedSingleKey({ key: "ArrowDown", ...NO_MODIFIERS })).toBe(
      false,
    );
    expect(isSuppressedSingleKey({ key: " ", ...NO_MODIFIERS })).toBe(false);
    expect(
      isSuppressedSingleKey({ key: "k", ...NO_MODIFIERS, ctrlKey: true }),
    ).toBe(false);
  });
});
