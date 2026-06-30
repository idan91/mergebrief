import { useEffect, useRef } from "react";

export interface KeyboardShortcutsOptions {
  /** Document-order chunk ids; J/K step through this list. */
  chunkIds: string[];
  activeChunkId: string | null;
  /** True while a modal/drawer/composer holds focus — shortcuts stand down. */
  disabled: boolean;
  focusModeActive: boolean;
  jumpToChunk: (chunkId: string) => void;
  toggleFocusMode: () => void;
  toggleHelp: () => void;
}

/** The minimal slice of a keydown event the decision logic needs. */
export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** Whether the event originated from a text-input-like element. */
  isTyping: boolean;
}

export interface ShortcutState {
  chunkIds: string[];
  activeChunkId: string | null;
  disabled: boolean;
  focusModeActive: boolean;
}

export type ShortcutAction =
  | { type: "jump"; chunkId: string }
  | { type: "toggleFocus" }
  | { type: "toggleHelp" };

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable;
}

/**
 * Pure decision: given a keystroke and the current reading state, what should
 * happen — or nothing? Extracted from the hook so the branching (key mapping,
 * J/K index clamping, the typing/overlay/modifier stand-downs, and Escape
 * layering) is unit-testable without a DOM. Returns null for "ignore this key".
 *
 * Escape exits focus mode only when no overlay is claiming the key (`disabled`),
 * so closing a modal with Escape doesn't also drop you out of focus mode.
 */
export function resolveShortcut(
  event: ShortcutEvent,
  state: ShortcutState,
): ShortcutAction | null {
  if (event.key === "Escape") {
    return state.focusModeActive && !state.disabled
      ? { type: "toggleFocus" }
      : null;
  }
  if (state.disabled) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.isTyping) return null;

  if (event.key === "j" || event.key === "k") {
    const { chunkIds, activeChunkId } = state;
    if (chunkIds.length === 0) return null;
    const index = activeChunkId ? chunkIds.indexOf(activeChunkId) : -1;
    const next =
      event.key === "j"
        ? chunkIds[Math.min(index + 1, chunkIds.length - 1)]
        : chunkIds[Math.max(index - 1, 0)];
    if (!next || next === activeChunkId) return null;
    return { type: "jump", chunkId: next };
  }

  if (event.key === "z") return { type: "toggleFocus" };
  if (event.key === "?") return { type: "toggleHelp" };
  return null;
}

/**
 * Global J/K (next/prev chunk), Z (focus mode), ? (shortcuts hint), Esc (exit
 * focus mode). Modeled on Atlas's reading shortcuts. Stands down while typing or
 * while an overlay (drawer/modal/composer) holds focus, so it never steals keys
 * mid-edit.
 *
 * The listener binds once and reads the latest options through a ref, so it does
 * not churn `addEventListener` on every navigation (the handler is on a hot path
 * — every keystroke on the page).
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const o = latest.current;
      const action = resolveShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          isTyping: isTypingTarget(event.target),
        },
        {
          chunkIds: o.chunkIds,
          activeChunkId: o.activeChunkId,
          disabled: o.disabled,
          focusModeActive: o.focusModeActive,
        },
      );
      if (!action) return;
      event.preventDefault();
      if (action.type === "jump") o.jumpToChunk(action.chunkId);
      else if (action.type === "toggleFocus") o.toggleFocusMode();
      else o.toggleHelp();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
