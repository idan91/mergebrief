import { Button } from "@web/components/Button";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

export interface ThreadResolveActionProps {
  /** The thread's current server state, picks the offered direction. */
  resolved: boolean;
  pending: boolean;
  /** The id of the last attempt's failure copy, which the owner renders; absent while there is none. */
  errorId: string | undefined;
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
  errorId,
  onToggle,
  exposeButton,
}: ThreadResolveActionProps) {
  const { t } = useTranslation();
  const label = deriveResolveLabel(t, resolved, pending);
  return (
    <Button
      aria-busy={pending || undefined}
      aria-describedby={errorId}
      aria-disabled={pending || undefined}
      data-state={resolved ? "resolved" : "open"}
      data-testid="thread-resolve"
      ref={exposeButton}
      variant="quiet"
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}
