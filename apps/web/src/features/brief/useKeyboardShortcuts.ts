import { useEffect } from "react";

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

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable;
}

/**
 * Global J/K (next/prev chunk), Z (focus mode), ? (shortcuts hint). Modeled on
 * Atlas's reading shortcuts. Stands down while typing or while an overlay
 * (drawer/modal/composer) holds focus, so it never steals keys mid-edit.
 */
export function useKeyboardShortcuts({
  chunkIds,
  activeChunkId,
  disabled,
  focusModeActive,
  jumpToChunk,
  toggleFocusMode,
  toggleHelp,
}: KeyboardShortcutsOptions): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && focusModeActive) {
        toggleFocusMode();
        event.preventDefault();
        return;
      }
      if (disabled) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "j" || event.key === "k") {
        if (chunkIds.length === 0) return;
        const index = activeChunkId ? chunkIds.indexOf(activeChunkId) : -1;
        const next =
          event.key === "j"
            ? chunkIds[Math.min(index + 1, chunkIds.length - 1)]
            : chunkIds[Math.max(index - 1, 0)];
        if (next && next !== activeChunkId) jumpToChunk(next);
        event.preventDefault();
        return;
      }

      if (event.key === "z") {
        toggleFocusMode();
        event.preventDefault();
        return;
      }

      if (event.key === "?") {
        toggleHelp();
        event.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeChunkId,
    chunkIds,
    disabled,
    focusModeActive,
    jumpToChunk,
    toggleFocusMode,
    toggleHelp,
  ]);
}
