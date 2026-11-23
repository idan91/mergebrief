import type { ReactNode } from "react";

import { Button } from "@web/components/Button";
import { handOffFocusOnRemoval } from "../../../utils/focus-hand-off";

import { MoreRuns } from "./MoreRuns";
import styles from "./TriggerAction.module.scss";

export interface TriggerMoreRuns {
  /** The caret's accessible name. */
  label: string;
  /** `Menu.Item` rows behind the caret. */
  rows: ReactNode;
  /** Their outcome line, shown only: their hook speaks through the page's region. */
  outcome: string;
}

export interface TriggerActionProps {
  pending: boolean;
  /** The button's label at rest and while the request is in flight. */
  actionLabel: string;
  pendingLabel: string;
  /** The outcome line; its region stays mounted so each change is read. */
  announcement: string;
  /** Absent while the card offers no run; the outcome line stays. */
  onTrigger?: (() => void) | undefined;
  /** Other ways to queue the run, behind a caret joined to the button. */
  moreRuns?: TriggerMoreRuns | undefined;
}

/**
 * A card's one button that queues a run, with its outcome line; `moreRuns`
 * splits it, with a caret menu of other ways to queue it.
 */
export function TriggerAction({
  pending,
  actionLabel,
  pendingLabel,
  announcement,
  onTrigger,
  moreRuns,
}: TriggerActionProps) {
  const label = pending ? pendingLabel : actionLabel;
  const layout = onTrigger === undefined ? "outcome-only" : "offered";
  const split = onTrigger !== undefined && moreRuns !== undefined;

  return (
    <div className={styles["action"]} data-state={layout}>
      {onTrigger === undefined ? null : (
        <div
          className={styles["buttons"]}
          data-state={split ? "split" : undefined}
        >
          <Button
            ref={handOffFocusOnRemoval}
            className={styles["run"]}
            loading={pending}
            type="button"
            variant="primary"
            onClick={onTrigger}
          >
            {label}
          </Button>
          {moreRuns === undefined ? null : (
            <MoreRuns
              disabled={pending}
              label={moreRuns.label}
              rows={moreRuns.rows}
            />
          )}
        </div>
      )}
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles["outcome"]}
        role="status"
      >
        {announcement}
      </p>
      {moreRuns === undefined ? null : (
        <p className={styles["outcome"]}>{moreRuns.outcome}</p>
      )}
    </div>
  );
}
