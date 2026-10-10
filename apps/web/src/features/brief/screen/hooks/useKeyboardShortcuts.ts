import { useEffect, useRef } from "react";

import { isTypingTarget } from "../../../../utils/typingTarget";
import { isInsideMenuOrDialog } from "../../../../utils/overlay-target";

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
  /** A carried draft waits for its lines; Escape disarms it first. */
  reanchorArmed?: boolean | undefined;
  cancelReanchor?: (() => void) | undefined;
  /** Focus mode's context panel is showing; Escape closes it first. */
  focusPanelOpen?: boolean | undefined;
  toggleFocusPanel?: (() => void) | undefined;
  closeFocusPanel?: (() => void) | undefined;
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
  reanchorArmed: boolean;
  focusPanelOpen: boolean;
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
  | { type: "cancelReanchor" }
  | { type: "toggleFocusPanel" }
  | { type: "closeFocusPanel" }
  | { type: "markViewed"; chunkId: string };

function resolveGroupJump(
  key: StepKey,
  state: ShortcutState,
): ShortcutAction | null {
  const { chunkIds, groupBoundaries, activeChunkId } = state;
  if (groupBoundaries.length === 0) {
    return null;
  }

  const activeIndex = activeChunkId ? chunkIds.indexOf(activeChunkId) : -1;
  let currentGroup = -1;
  for (const [groupIndex, boundary] of groupBoundaries.entries()) {
    if (activeIndex >= boundary) {
      currentGroup = groupIndex;
    }
  }

  const nextGroup =
    key === "j"
      ? Math.min(currentGroup + 1, groupBoundaries.length - 1)
      : Math.max(currentGroup - 1, 0);

  const targetIndex = groupBoundaries[nextGroup];
  const next = targetIndex === undefined ? undefined : chunkIds[targetIndex];
  if (!next || next === activeChunkId) {
    return null;
  }

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
    if (state.disabled) {
      return null;
    }
    if (state.reanchorArmed) {
      return { type: "cancelReanchor" };
    }
    if (state.lineSelected) {
      return { type: "clearLineSelection" };
    }
    if (!state.focusModeActive) {
      return null;
    }
    return state.focusPanelOpen
      ? { type: "closeFocusPanel" }
      : { type: "toggleFocus" };
  }
  if (state.disabled) {
    return null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }
  if (event.isTyping) {
    return null;
  }
  if (state.sheetOpen && key !== "s") {
    return null;
  }

  if (key === "j" || key === "k") {
    if (event.shiftKey) {
      return resolveGroupJump(key, state);
    }

    const { chunkIds, activeChunkId } = state;
    if (chunkIds.length === 0) {
      return null;
    }

    const index = activeChunkId ? chunkIds.indexOf(activeChunkId) : -1;
    const next =
      key === "j"
        ? chunkIds[Math.min(index + 1, chunkIds.length - 1)]
        : chunkIds[Math.max(index - 1, 0)];
    if (!next || next === activeChunkId) {
      return null;
    }

    return { type: "jump", chunkId: next };
  }

  const flat = FLAT_ACTIONS[key];
  if (flat) {
    return flat;
  }

  if (key === "s" && !event.shiftKey) {
    return state.focusModeActive
      ? { type: "toggleFocusPanel" }
      : { type: "toggleSidebar" };
  }

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

type ShortcutActionType = ShortcutAction["type"];

type ShortcutActionOf<Type extends ShortcutActionType> = Extract<
  ShortcutAction,
  { type: Type }
>;

type ShortcutHandler = () => void;

/** An absent callback answers undefined, so the key falls through unclaimed. */
type ShortcutHandlers = {
  [Type in ShortcutActionType]: (
    options: KeyboardShortcutsOptions,
    action: ShortcutActionOf<Type>,
  ) => ShortcutHandler | undefined;
};

const SHORTCUT_HANDLERS: ShortcutHandlers = {
  jump: (options, action) => () => options.jumpToChunk(action.chunkId),
  toggleFocus: (options) => options.toggleFocusMode,
  toggleHelp: (options) => options.toggleHelp,
  jumpToConversation: (options) => options.jumpToConversation,
  toggleSidebar: (options) => options.toggleSidebar,
  toggleDiffView: (options) => options.toggleDiffView,
  clearLineSelection: (options) => options.clearLineSelection,
  cancelReanchor: (options) => options.cancelReanchor,
  toggleFocusPanel: (options) => options.toggleFocusPanel,
  closeFocusPanel: (options) => options.closeFocusPanel,
  markViewed: (options, action) => () => options.markViewed(action.chunkId),
};

function resolveShortcutHandler<Type extends ShortcutActionType>(
  options: KeyboardShortcutsOptions,
  action: ShortcutActionOf<Type>,
): ShortcutHandler | undefined {
  const resolve: ShortcutHandlers[Type] = SHORTCUT_HANDLERS[action.type];
  return resolve(options, action);
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
      if (isInsideMenuOrDialog(event.target)) {
        return;
      }
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
          reanchorArmed: current.reanchorArmed === true,
          focusPanelOpen: current.focusPanelOpen === true,
        },
      );
      if (!action) {
        return;
      }
      const handler = resolveShortcutHandler(current, action);
      if (!handler) {
        return;
      }

      event.preventDefault();
      handler();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
