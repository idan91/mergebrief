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
  shiftKey: false,
  isTyping: false,
  ...over,
});

const state = (over: Partial<ShortcutState> = {}): ShortcutState => ({
  chunkIds: ["a", "b", "c"],
  groupBoundaries: [],
  activeChunkId: "b",
  disabled: false,
  sheetOpen: false,
  focusModeActive: false,
  ...over,
});

// Three groups over five chunks, in Reading order: [a, b] [c, d] [e].
const groupedState = (over: Partial<ShortcutState> = {}): ShortcutState =>
  state({
    chunkIds: ["a", "b", "c", "d", "e"],
    groupBoundaries: [0, 2, 4],
    ...over,
  });

describe("resolveShortcut", () => {
  it("only S fires while the sidebar sheet is open", () => {
    const open = state({ sheetOpen: true, activeChunkId: "a" });
    expect(resolveShortcut(key("s"), open)).toEqual({
      type: "toggleSidebar",
    });
    for (const k of ["j", "k", "z", "c", "?"]) {
      expect(resolveShortcut(key(k), open)).toBeNull();
    }
    expect(resolveShortcut(key("J", { shiftKey: true }), open)).toBeNull();
  });

  it("s toggles the sidebar", () => {
    expect(resolveShortcut(key("s"), state())).toEqual({
      type: "toggleSidebar",
    });
  });

  it("shift+S is not a sidebar toggle", () => {
    expect(resolveShortcut(key("S", { shiftKey: true }), state())).toBeNull();
  });

  it("s stands down while typing", () => {
    expect(resolveShortcut(key("s", { isTyping: true }), state())).toBeNull();
  });

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

  it("v marks the active chunk viewed in focus mode", () => {
    expect(resolveShortcut(key("v"), state({ focusModeActive: true }))).toEqual(
      { type: "markViewed", chunkId: "b" },
    );
  });

  it("v is inert outside focus mode and with no active chunk", () => {
    expect(resolveShortcut(key("v"), state())).toBeNull();
    expect(
      resolveShortcut(
        key("v"),
        state({ focusModeActive: true, activeChunkId: null }),
      ),
    ).toBeNull();
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

  it("Shift+J jumps to the next group's first chunk in Reading order", () => {
    expect(
      resolveShortcut(
        key("j", { shiftKey: true }),
        groupedState({ activeChunkId: "a" }),
      ),
    ).toEqual({ type: "jump", chunkId: "c" });
  });

  it("Shift+K jumps to the previous group's first chunk in Reading order", () => {
    expect(
      resolveShortcut(
        key("k", { shiftKey: true }),
        groupedState({ activeChunkId: "d" }),
      ),
    ).toEqual({ type: "jump", chunkId: "a" });
  });

  it("Shift+J from the middle of a group jumps forward, not to the group's own start", () => {
    expect(
      resolveShortcut(
        key("j", { shiftKey: true }),
        groupedState({ activeChunkId: "d" }),
      ),
    ).toEqual({ type: "jump", chunkId: "e" });
  });

  it("Shift+J clamps at the last group (no jump)", () => {
    expect(
      resolveShortcut(
        key("j", { shiftKey: true }),
        groupedState({ activeChunkId: "e" }),
      ),
    ).toBeNull();
  });

  it("Shift+K clamps at the first group (no jump)", () => {
    expect(
      resolveShortcut(
        key("k", { shiftKey: true }),
        groupedState({ activeChunkId: "a" }),
      ),
    ).toBeNull();
  });

  it("Shift+J with no active chunk starts at the first group", () => {
    expect(
      resolveShortcut(
        key("j", { shiftKey: true }),
        groupedState({ activeChunkId: null }),
      ),
    ).toEqual({ type: "jump", chunkId: "a" });
  });

  it("Shift+J does nothing without group boundaries", () => {
    expect(resolveShortcut(key("j", { shiftKey: true }), state())).toBeNull();
  });

  it("plain J/K ignore shiftKey-less chords exactly as before, unaffected by groupBoundaries", () => {
    expect(
      resolveShortcut(key("j"), groupedState({ activeChunkId: "a" })),
    ).toEqual({ type: "jump", chunkId: "b" });
    expect(
      resolveShortcut(key("k"), groupedState({ activeChunkId: "d" })),
    ).toEqual({ type: "jump", chunkId: "c" });
  });
});

describe("conversation shortcut", () => {
  const shortcutState = {
    chunkIds: ["c1"],
    groupBoundaries: [0],
    activeChunkId: null,
    disabled: false,
    sheetOpen: false,
    focusModeActive: false,
  };

  it("maps C to jump-to-conversation", () => {
    expect(
      resolveShortcut(
        {
          key: "c",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          isTyping: false,
        },
        shortcutState,
      ),
    ).toEqual({ type: "jumpToConversation" });
  });

  it("stands down while typing or disabled", () => {
    expect(
      resolveShortcut(
        {
          key: "c",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          isTyping: true,
        },
        shortcutState,
      ),
    ).toBeNull();
    expect(
      resolveShortcut(
        {
          key: "c",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          isTyping: false,
        },
        { ...shortcutState, disabled: true },
      ),
    ).toBeNull();
  });
});
