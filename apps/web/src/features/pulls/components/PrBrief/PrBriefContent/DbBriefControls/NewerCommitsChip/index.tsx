import { useId } from "react";

import { handOffFocusOnRemoval } from "../../../../../utils/focus-hand-off";
import { ActionButton } from "./ActionButton";
import { ExplainPopover } from "./ExplainPopover";
import styles from "./NewerCommitsChip.module.scss";
import {
  NewerCommitsActionKinds,
  NewerCommitsStates,
  type NewerCommitsStatus,
} from "./types";

export interface NewerCommitsChipProps {
  status: NewerCommitsStatus;
}

/**
 * One chip for every way the brief on screen trails the pull request:
 * [label | status] plus an attached action, either of the last two absent
 * when the other says it all, then the info button, which wraps with the
 * action. The group is named by
 * the chip's words, so the action reads in context. The chip hands focus
 * to the main landmark if it leaves while holding it.
 */
export function NewerCommitsChip({ status }: NewerCommitsChipProps) {
  const labelId = useId();
  const statusId = useId();
  const { action, statusLabel, failure } = status;
  const generating = status.state === NewerCommitsStates.GENERATING;
  const spinner = generating ? (
    <span
      aria-hidden="true"
      className={styles["spinner"]}
      data-testid="newer-commits-spinner"
    />
  ) : null;
  const splitVariant = action === undefined ? undefined : "attached";
  const besideNewerBrief =
    action?.kind === NewerCommitsActionKinds.NAVIGATE &&
    statusLabel !== undefined;
  const variant = besideNewerBrief ? "beside-newer-brief" : undefined;
  const groupLabelIds =
    statusLabel === undefined ? labelId : `${labelId} ${statusId}`;

  return (
    <span
      aria-labelledby={groupLabelIds}
      className={styles["root"]}
      data-state={status.state}
      data-variant={variant}
      ref={handOffFocusOnRemoval}
      role="group"
    >
      <span
        className={styles["split"]}
        data-variant={splitVariant}
        data-testid="newer-commits-chip"
      >
        <span className={styles["label"]} id={labelId}>
          <span aria-hidden="true" className={styles["dot"]} />
          {status.label}
        </span>
        {statusLabel === undefined ? null : (
          <span className={styles["status"]} id={statusId}>
            {spinner}
            {statusLabel}
          </span>
        )}
      </span>
      <span className={styles["tail"]}>
        {action === undefined ? null : (
          <ActionButton action={action} className={styles["action"]} />
        )}
        <ExplainPopover status={status} />
      </span>
      {failure === undefined ? null : (
        <span className={styles["failure"]}>{failure}</span>
      )}
    </span>
  );
}
