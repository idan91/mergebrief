import { useEffect, useRef } from "react";

import { isTypingTarget } from "../../../utils/typingTarget";
import { isInsideMenuOrDialog } from "../../../utils/overlay-target";

export interface KeyboardShortcutsOptions {
  chunkIds: string[];
  /** Indices into `chunkIds` where each group starts, e.g. `[0, 3, 5]`. */
  groupBoundaries: number[];
  /** A getter: a position change must not re-render the host screen. */
  getActiveChunkId: () => string | null;
  disabled: boolean;
  sheetOpen: boolean;
  focusModeActive: boolean;
  /** Viewed exists only in Full scope; Changes has cards, not chunks. */
  markViewedAvailable: boolean;
  jumpToChunk: (chunkId: string) => void;
  toggleFocusMode: () => void;
  toggleHelp: () => void;
  markViewed: (chunkId: string) => void;
  jumpToConversation?: (() => void) | undefined;
  toggleSidebar?: (() => void) | undefined;
  toggleDiffView?: (() => void) | undefined;
  /** A line selection exists; Escape clears it before anything else. */
  lineSelected?: boolean | undefined;
  clearLineSelection?: (() => void) | undefined;
}

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isTyping: boolean;
}

export interface ShortcutState {
  chunkIds: string[];
  groupBoundaries: number[];
  activeChunkId: string | null;
  disabled: boolean;
  sheetOpen: boolean;
  focusModeActive: boolean;
  viewedAvailable: boolean;
  lineSelected: boolean;
}

export type StepKey = "j" | "k";

export type ShortcutAction =
  | { type: "jump"; chunkId: string }
  | { type: "toggleFocus" }
  | { type: "toggleHelp" }
  | { type: "jumpToConversation" }
  | { type: "toggleSidebar" }
  | { type: "toggleDiffView" }
  | { type: "clearLineSelection" }
  | { type: "markViewed"; chunkId: string };

function resolveGroupJump(
  key: StepKey,
  state: ShortcutState,
): ShortcutAction | null {
  const { chunkIds, groupBoundaries, activeChunkId } = state;
  if (groupBoundaries.length === 0) return null;

  const activeIndex = activeChunkId ? chunkIds.indexOf(activeChunkId) : -1;
  let currentGroup = -1;
  for (const [groupIndex, boundary] of groupBoundaries.entries()) {
    if (activeIndex >= boundary) currentGroup = groupIndex;
  }

  const nextGroup =
    key === "j"
      ? Math.min(currentGroup + 1, groupBoundaries.length - 1)
      : Math.max(currentGroup - 1, 0);

  const targetIndex = groupBoundaries[nextGroup];
  const next = targetIndex === undefined ? undefined : chunkIds[targetIndex];
  if (!next || next === activeChunkId) return null;

  return { type: "jump", chunkId: next };
}

const FLAT_ACTIONS: Readonly<Record<string, ShortcutAction>> = {
  z: { type: "toggleFocus" },
  "?": { type: "toggleHelp" },
  c: { type: "jumpToConversation" },
  d: { type: "toggleDiffView" },
};

export function resolveShortcut(
  event: ShortcutEvent,
  state: ShortcutState,
): ShortcutAction | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (key === "Escape") {
    if (state.disabled) return null;
    if (state.lineSelected) return { type: "clearLineSelection" };
    return state.focusModeActive ? { type: "toggleFocus" } : null;
  }
  if (state.disabled) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.isTyping) return null;
  if (state.sheetOpen && key !== "s") return null;

  if (key === "j" || key === "k") {
    if (event.shiftKey) return resolveGroupJump(key, state);

    const { chunkIds, activeChunkId } = state;
    if (chunkIds.length === 0) return null;

    const index = activeChunkId ? chunkIds.indexOf(activeChunkId) : -1;
    const next =
      key === "j"
        ? chunkIds[Math.min(index + 1, chunkIds.length - 1)]
        : chunkIds[Math.max(index - 1, 0)];
    if (!next || next === activeChunkId) return null;

    return { type: "jump", chunkId: next };
  }

  const flat = FLAT_ACTIONS[key];
  if (flat) return flat;

  if (key === "s" && !event.shiftKey) return { type: "toggleSidebar" };

  // Focus mode only, a global V would silently collapse arbitrary chunks;
  // and Full scope only, Changes shows cards that are not chunks.
  if (key === "v" && state.focusModeActive && state.viewedAvailable) {
    const { activeChunkId } = state;
    return activeChunkId === null
      ? null
      : { type: "markViewed", chunkId: activeChunkId };
  }

  return null;
}

/**
 * Stands down while typing, inside an open menu or dialog, or while an
 * overlay holds focus, so it never steals keys mid-edit. The listener binds once and reads
 * options through a ref, so navigation does not churn the handler.
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isInsideMenuOrDialog(event.target)) return;
      const current = latest.current;
      const action = resolveShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          isTyping: isTypingTarget(event.target),
        },
        {
          chunkIds: current.chunkIds,
          groupBoundaries: current.groupBoundaries,
          activeChunkId: current.getActiveChunkId(),
          disabled: current.disabled,
          sheetOpen: current.sheetOpen,
          focusModeActive: current.focusModeActive,
          viewedAvailable: current.markViewedAvailable,
          lineSelected: current.lineSelected === true,
        },
      );
      if (!action) return;
      if (action.type === "jumpToConversation" && !current.jumpToConversation) {
        return;
      }
      if (action.type === "toggleSidebar" && !current.toggleSidebar) return;
      if (action.type === "toggleDiffView" && !current.toggleDiffView) return;
      event.preventDefault();
      if (action.type === "jump") current.jumpToChunk(action.chunkId);
      else if (action.type === "toggleFocus") current.toggleFocusMode();
      else if (action.type === "jumpToConversation")
        current.jumpToConversation?.();
      else if (action.type === "toggleSidebar") current.toggleSidebar?.();
      else if (action.type === "toggleDiffView") current.toggleDiffView?.();
      else if (action.type === "clearLineSelection")
        current.clearLineSelection?.();
      else if (action.type === "markViewed") current.markViewed(action.chunkId);
      else current.toggleHelp();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
