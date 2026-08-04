import { useId } from "react";

import rowStyles from "../../../../rows.module.scss";

export interface ThreadResolveActionProps {
  /** The thread's current server state — picks the offered direction. */
  resolved: boolean;
  pending: boolean;
  /** Failure copy from the last attempt; null while there is none. */
  error: string | null;
  onToggle: () => void;
  /**
   * Hands the button's node to the owner (the `exposeTextarea` pattern), which
   * needs it as a focus destination when the composer's combo action retires
   * mid-flow. Called with null on unmount.
   */
  exposeButton?: ((element: HTMLButtonElement | null) => void) | undefined;
}

/**
 * The standalone resolve/unresolve action at the bottom of an expanded thread
 * (BRIEF-93, GitHub's model): ONE button, whose direction is the thread's
 * state. The caller renders it only when the viewer may resolve — there is no
 * disabled-dead variant (ADR 0031).
 *
 * Focusable-disabled while pending (the ReplyComposer/SubmitModal pattern): a
 * hard `disabled` would drop keyboard and screen-reader focus to `<body>` the
 * moment the request starts. The click guard lives in the hook.
 */
export function ThreadResolveAction({
  resolved,
  pending,
  error,
  onToggle,
  exposeButton,
}: ThreadResolveActionProps) {
  const errorId = `${useId()}-resolve-error`;
  const label = resolved
    ? pending
      ? "Unresolving…"
      : "Unresolve"
    : pending
      ? "Resolving…"
      : "Resolve";
  return (
    <>
      <div className={rowStyles["detailActions"]}>
        <button
          aria-busy={pending || undefined}
          aria-describedby={error === null ? undefined : errorId}
          aria-disabled={pending || undefined}
          className={rowStyles["action"]}
          data-state={resolved ? "resolved" : "open"}
          data-testid="thread-resolve"
          ref={exposeButton}
          type="button"
          onClick={onToggle}
        >
          {label}
        </button>
      </div>
      {error === null ? null : (
        <p className={rowStyles["error"]} id={errorId} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
