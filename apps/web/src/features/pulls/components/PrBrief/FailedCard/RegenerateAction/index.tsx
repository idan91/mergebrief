import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { handOffFocusOnRemoval } from "../../../../utils/focus-hand-off";

import styles from "./RegenerateAction.module.scss";

export interface RegenerateActionProps {
  pending: boolean;
  /** The outcome line; its region stays mounted so each change is read. */
  announcement: string;
  /** Absent while the card offers no Regenerate; the outcome line stays. */
  onRegenerate?: (() => void) | undefined;
}

export function RegenerateAction({
  pending,
  announcement,
  onRegenerate,
}: RegenerateActionProps) {
  const { t } = useTranslation();
  const label = pending
    ? t("pulls.failed.regenerate.pending")
    : t("pulls.failed.regenerate.action");
  const layout = onRegenerate === undefined ? "outcome-only" : "offered";

  return (
    <div className={styles["action"]} data-state={layout}>
      {onRegenerate === undefined ? null : (
        <Button
          ref={handOffFocusOnRemoval}
          loading={pending}
          type="button"
          variant="accent"
          onClick={onRegenerate}
        >
          {label}
        </Button>
      )}
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles["outcome"]}
        role="status"
      >
        {announcement}
      </p>
    </div>
  );
}
