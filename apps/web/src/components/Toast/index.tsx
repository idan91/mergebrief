import { useEffect, useRef } from "react";

import styles from "./Toast.module.scss";
import { ToastActionButton } from "./ToastActionButton";
import {
  ToastHoldSources,
  type ToastAction,
  type ToastHoldSource,
} from "./types";

export interface ToastProps {
  message: string;
  /** The line is on screen; the live region's text blanks for a frame on each new line. */
  shown?: boolean;
  /** Spoken only, beside the line; the line and its action stay as they are. */
  aside?: string;
  action?: ToastAction | undefined;
  /** A request the action would collide with is still running. */
  actionDisabled?: boolean;
  testId?: string;
  /** Pointer or focus arrived, so the line must not leave under it. */
  onHold?: (source: ToastHoldSource) => void;
  onRelease?: (source: ToastHoldSource) => void;
  /** The action left while it held focus; the caller says where focus lands. */
  onActionLeft?: () => void;
}

/**
 * The page-level result line. Stays mounted: the region inside it is the
 * page's polite live region, and a region inserted with its text is never read.
 */
export function Toast({
  message,
  shown = message !== "",
  aside = "",
  action,
  actionDisabled = false,
  testId,
  onHold,
  onRelease,
  onActionLeft,
}: ToastProps) {
  const actionHint = message === "" ? undefined : action?.hint;
  const showsAction = action !== undefined && shown;
  const toastState = shown ? "visible" : "hidden";
  const rootRef = useRef<HTMLDivElement | null>(null);

  // A disabled action cannot be used yet, so its line waits for the request.
  const actionWaits = showsAction && actionDisabled;
  useEffect(() => {
    if (!actionWaits) {
      return undefined;
    }
    onHold?.(ToastHoldSources.PENDING);
    return () => onRelease?.(ToastHoldSources.PENDING);
  }, [actionWaits, onHold, onRelease]);

  // A focused action that unmounts fires no blur, so its focus hold ends here.
  useEffect(() => {
    const focusLeftWithAction =
      !showsAction && !rootRef.current?.contains(document.activeElement);
    if (focusLeftWithAction) {
      onRelease?.(ToastHoldSources.FOCUS);
    }
  }, [showsAction, onRelease]);

  return (
    // The handlers only hold the timer; the action inside stays the interactive element.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={styles["toast"]}
      data-state={toastState}
      data-testid={testId}
      onBlur={() => onRelease?.(ToastHoldSources.FOCUS)}
      onFocus={() => onHold?.(ToastHoldSources.FOCUS)}
      onPointerEnter={() => onHold?.(ToastHoldSources.POINTER)}
      onPointerLeave={() => onRelease?.(ToastHoldSources.POINTER)}
      ref={rootRef}
    >
      <p aria-atomic="true" aria-live="polite" role="status">
        {message}
        {actionHint === undefined ? null : (
          <span className="sr-only"> {actionHint}</span>
        )}
      </p>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {aside}
      </p>
      {showsAction ? (
        <ToastActionButton
          action={action}
          disabled={actionDisabled}
          onLeftFocused={onActionLeft}
        />
      ) : null}
    </div>
  );
}
