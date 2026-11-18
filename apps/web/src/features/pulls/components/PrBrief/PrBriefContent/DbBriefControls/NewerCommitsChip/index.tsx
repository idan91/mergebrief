import { useEffect, useId, useState } from "react";

import { MarkLoader } from "@web/components/MarkLoader";
import { MarkLoaderTones } from "@web/components/MarkLoader/types";
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
  const counting = status.liveStatus === true;
  // A live region reads changes after it mounted, never what it mounted
  // with: the announcer mounts empty and takes the count in an effect, so
  // the first count is read like every later one, while the visible
  // segment renders the count from the server on.
  const [announcedText, setAnnouncedText] = useState("");
  useEffect(() => {
    setAnnouncedText(statusLabel ?? "");
  }, [statusLabel]);
  const generating = status.state === NewerCommitsStates.GENERATING;
  const loader = generating ? (
    <MarkLoader testId="newer-commits-loader" tone={MarkLoaderTones.MUTED} />
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
          <span
            aria-hidden={counting ? true : undefined}
            className={styles["status"]}
            id={statusId}
          >
            {loader}
            {statusLabel}
          </span>
        )}
      </span>
      {counting ? (
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          {announcedText}
        </span>
      ) : null}
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
