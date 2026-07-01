import { describe, expect, it } from "vitest";

import {
  resolveShortcut,
  type ShortcutEvent,
  type ShortcutState,
} from "./useKeyboardShortcuts";

const key = (k: string, over: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isTyping: false,
  ...over,
});

const state = (over: Partial<ShortcutState> = {}): ShortcutState => ({
  chunkIds: ["a", "b", "c"],
  activeChunkId: "b",
  disabled: false,
  focusModeActive: false,
  ...over,
});

describe("resolveShortcut", () => {
  it("j advances to the next chunk", () => {
    expect(resolveShortcut(key("j"), state({ activeChunkId: "a" }))).toEqual({
      type: "jump",
      chunkId: "b",
    });
  });

  it("k retreats to the previous chunk", () => {
    expect(resolveShortcut(key("k"), state({ activeChunkId: "c" }))).toEqual({
      type: "jump",
      chunkId: "b",
    });
  });

  it("j with no active chunk starts at the first", () => {
    expect(resolveShortcut(key("j"), state({ activeChunkId: null }))).toEqual({
      type: "jump",
      chunkId: "a",
    });
  });

  it("j clamps at the last chunk (no jump)", () => {
    expect(resolveShortcut(key("j"), state({ activeChunkId: "c" }))).toBeNull();
  });

  it("k clamps at the first chunk (no jump)", () => {
    expect(resolveShortcut(key("k"), state({ activeChunkId: "a" }))).toBeNull();
  });

  it("j with no chunks does nothing", () => {
    expect(resolveShortcut(key("j"), state({ chunkIds: [] }))).toBeNull();
  });

  it("z toggles focus mode", () => {
    expect(resolveShortcut(key("z"), state())).toEqual({ type: "toggleFocus" });
  });

  it("accepts uppercase reading shortcuts from shifted or caps-lock keys", () => {
    expect(resolveShortcut(key("J"), state({ activeChunkId: "a" }))).toEqual({
      type: "jump",
      chunkId: "b",
    });
    expect(resolveShortcut(key("K"), state({ activeChunkId: "c" }))).toEqual({
      type: "jump",
      chunkId: "b",
    });
    expect(resolveShortcut(key("Z"), state())).toEqual({ type: "toggleFocus" });
  });

  it("? toggles the help modal", () => {
    expect(resolveShortcut(key("?"), state())).toEqual({ type: "toggleHelp" });
  });

  it("Escape exits focus mode when active and nothing else claims the key", () => {
    expect(
      resolveShortcut(key("Escape"), state({ focusModeActive: true })),
    ).toEqual({ type: "toggleFocus" });
  });

  it("Escape is ignored while an overlay is open, so the overlay closes first", () => {
    expect(
      resolveShortcut(
        key("Escape"),
        state({ focusModeActive: true, disabled: true }),
      ),
    ).toBeNull();
  });

  it("Escape does nothing when focus mode is not active", () => {
    expect(resolveShortcut(key("Escape"), state())).toBeNull();
  });

  it("stands down entirely while disabled", () => {
    expect(resolveShortcut(key("j"), state({ disabled: true }))).toBeNull();
    expect(resolveShortcut(key("z"), state({ disabled: true }))).toBeNull();
    expect(resolveShortcut(key("?"), state({ disabled: true }))).toBeNull();
  });

  it("ignores keys while typing in an input", () => {
    expect(resolveShortcut(key("j", { isTyping: true }), state())).toBeNull();
  });

  it("ignores chords so it never steals browser/OS shortcuts", () => {
    expect(resolveShortcut(key("j", { metaKey: true }), state())).toBeNull();
    expect(resolveShortcut(key("j", { ctrlKey: true }), state())).toBeNull();
    expect(resolveShortcut(key("z", { altKey: true }), state())).toBeNull();
  });

  it("ignores unmapped keys", () => {
    expect(resolveShortcut(key("x"), state())).toBeNull();
  });
});
