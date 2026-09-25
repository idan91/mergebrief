import { useId } from "react";

import { Button } from "@web/components/Button";
import rowStyles from "../../../../rows.module.scss";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

export interface ThreadResolveActionProps {
  /** The thread's current server state, picks the offered direction. */
  resolved: boolean;
  pending: boolean;
  /** Failure copy from the last attempt; null while there is none. */
  error: string | null;
  onToggle: () => void;
  /**
   * Hands the button's node to the owner, which needs it as a focus
   * destination when the composer's combo action retires mid-flow. Called
   * with null on unmount.
   */
  exposeButton?: ((element: HTMLButtonElement | null) => void) | undefined;
}

function deriveResolveLabel(
  t: TFunction,
  resolved: boolean,
  pending: boolean,
): string {
  if (resolved) {
    return pending
      ? t("conversation.unresolvingAction")
      : t("conversation.unresolveAction");
  }
  return pending
    ? t("conversation.resolvingAction")
    : t("conversation.resolveAction");
}

/**
 * Render only when resolution is permitted; the thread state sets direction.
 * Keep the pending button focusable to preserve keyboard and screen-reader focus.
 * The hook guards clicks while pending.
 */
export function ThreadResolveAction({
  resolved,
  pending,
  error,
  onToggle,
  exposeButton,
}: ThreadResolveActionProps) {
  const errorId = `${useId()}-resolve-error`;
  const { t } = useTranslation();
  const label = deriveResolveLabel(t, resolved, pending);
  return (
    <>
      <div className={rowStyles["detailActions"]}>
        <Button
          aria-busy={pending || undefined}
          aria-describedby={error === null ? undefined : errorId}
          aria-disabled={pending || undefined}
          data-state={resolved ? "resolved" : "open"}
          data-testid="thread-resolve"
          ref={exposeButton}
          variant="quiet"
          onClick={onToggle}
        >
          {label}
        </Button>
      </div>
      {error === null ? null : (
        <p className={rowStyles["error"]} id={errorId} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
