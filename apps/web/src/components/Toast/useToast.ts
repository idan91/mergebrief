import { useCallback, useEffect, useRef, useState } from "react";

import { useAnnouncer } from "@web/hooks/useAnnouncer";
import { TOAST_ACTION_VISIBLE_MS, TOAST_VISIBLE_MS } from "./consts";
import type { ToastAction, ToastHoldSource } from "./types";

export interface ToastState {
  readonly message: string;
  /** A line is on screen, steady through the announcer's blank frame. */
  readonly shown: boolean;
  readonly action: ToastAction | undefined;
  /** Spoken beside the line, never shown: an outcome that must not replace a newer action. */
  readonly aside: string;
  readonly show: (message: string, action?: ToastAction) => void;
  /**
   * Shows the outcome of the run `source` started. While a newer action holds
   * the line, the outcome is spoken at once, so that action stays usable; one
   * that offers an action of its own also shows once that line leaves.
   */
  readonly showOutcome: (
    message: string,
    source: ToastAction | undefined,
    action?: ToastAction,
  ) => void;
  readonly hold: (source: ToastHoldSource) => void;
  readonly release: (source: ToastHoldSource) => void;
}

interface WaitingLine {
  readonly message: string;
  readonly action: ToastAction;
}

/** One result line for a page that owns its own toast: shown, held while the pointer or focus is on it, gone. */
export function useToast(): ToastState {
  const { text, announce } = useAnnouncer();
  const { text: aside, announce: announceAside } = useAnnouncer();
  const [action, setAction] = useState<ToastAction | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const shownAction = useRef<ToastAction | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const visibleMs = useRef(TOAST_VISIBLE_MS);
  const holders = useRef(new Set<ToastHoldSource>());
  const waitingLines = useRef<WaitingLine[]>([]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const setLine = useCallback(
    (message: string, nextAction: ToastAction | undefined) => {
      visibleMs.current =
        nextAction === undefined ? TOAST_VISIBLE_MS : TOAST_ACTION_VISIBLE_MS;
      announce(message);
      announceAside("");
      shownAction.current = nextAction;
      setAction(nextAction);
      setShown(message !== "");
    },
    [announce, announceAside],
  );

  const arm = useCallback(() => {
    function startTimer(): void {
      window.clearTimeout(timer.current);
      if (holders.current.size > 0) {
        return;
      }
      timer.current = window.setTimeout(() => {
        const next = waitingLines.current.shift();
        if (next === undefined) {
          setLine("", undefined);
          return;
        }
        setLine(next.message, next.action);
        startTimer();
      }, visibleMs.current);
    }
    startTimer();
  }, [setLine]);

  const hold = useCallback((source: ToastHoldSource) => {
    holders.current.add(source);
    window.clearTimeout(timer.current);
  }, []);

  const release = useCallback(
    (source: ToastHoldSource) => {
      if (holders.current.delete(source)) {
        arm();
      }
    },
    [arm],
  );

  const show = useCallback(
    (message: string, nextAction?: ToastAction) => {
      setLine(message, nextAction);
      arm();
    },
    [setLine, arm],
  );

  const showOutcome = useCallback(
    (
      message: string,
      source: ToastAction | undefined,
      nextAction?: ToastAction,
    ) => {
      const newerAction =
        shownAction.current !== undefined && shownAction.current !== source;
      if (!newerAction) {
        show(message, nextAction);
        return;
      }

      announceAside(message);
      if (nextAction !== undefined) {
        waitingLines.current.push({ message, action: nextAction });
      }
    },
    [announceAside, show],
  );

  return {
    message: text,
    shown,
    action,
    aside,
    show,
    showOutcome,
    hold,
    release,
  };
}
