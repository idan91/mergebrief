import { Button } from "@web/components/Button";
import { handOffFocusOnRemoval } from "../../../utils/focus-hand-off";

import styles from "./TriggerAction.module.scss";

export interface TriggerActionProps {
  pending: boolean;
  /** The button's label at rest and while the request is in flight. */
  actionLabel: string;
  pendingLabel: string;
  /** The outcome line; its region stays mounted so each change is read. */
  announcement: string;
  /** Absent while the card offers no run; the outcome line stays. */
  onTrigger?: (() => void) | undefined;
}

/** A card's one button that queues a run, with its outcome line. */
export function TriggerAction({
  pending,
  actionLabel,
  pendingLabel,
  announcement,
  onTrigger,
}: TriggerActionProps) {
  const label = pending ? pendingLabel : actionLabel;
  const layout = onTrigger === undefined ? "outcome-only" : "offered";

  return (
    <div className={styles["action"]} data-state={layout}>
      {onTrigger === undefined ? null : (
        <Button
          ref={handOffFocusOnRemoval}
          loading={pending}
          type="button"
          variant="primary"
          onClick={onTrigger}
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
