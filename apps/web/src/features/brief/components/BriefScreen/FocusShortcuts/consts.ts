import type { FocusShortcut } from "./types";

export const FOCUS_SHORTCUTS: readonly FocusShortcut[] = [
  {
    id: "chunk",
    keys: [{ key: "J" }, { key: "K" }],
    descriptionKey: "brief.focusShortcuts.chunk",
  },
  {
    id: "group",
    keys: [
      { key: "J", shift: true },
      { key: "K", shift: true },
    ],
    descriptionKey: "brief.focusShortcuts.group",
  },
  {
    id: "viewed",
    keys: [{ key: "V" }],
    descriptionKey: "brief.focusShortcuts.viewed",
  },
  {
    id: "split",
    keys: [{ key: "D" }],
    descriptionKey: "brief.focusShortcuts.split",
  },
  {
    id: "exit",
    keys: [{ key: "Esc" }],
    descriptionKey: "brief.focusShortcuts.exit",
  },
  {
    id: "all",
    keys: [{ key: "?" }],
    descriptionKey: "brief.focusShortcuts.all",
  },
];

/** Pointer hover waits this long before revealing, so a pass-by stays shut. */
export const REVEAL_DELAY_MS = 150;
