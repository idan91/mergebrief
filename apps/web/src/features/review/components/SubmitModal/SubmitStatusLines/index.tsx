import type { SubmitStatus } from "../types";
import styles from "../SubmitModal.module.scss";
import { SubmitReason } from "./SubmitReason";

export interface SubmitStatusLinesProps {
  status: SubmitStatus;
  /** Someone has tried Submit; until then a reason is the button's description only. */
  reasonShown: boolean;
  /** The moved-head warning, for a view that does not carry its own. */
  staleWarning?: string | undefined;
}

export function SubmitStatusLines({
  status,
  reasonShown,
  staleWarning,
}: SubmitStatusLinesProps) {
  const noteShown = status.note !== null && status.error === null;
  return (
    <>
      {status.blockedReason === undefined ? null : (
        <SubmitReason id="submit-modal-blocked" shown={reasonShown}>
          {status.blockedReason}
        </SubmitReason>
      )}
      {staleWarning === undefined ? null : (
        <SubmitReason id="submit-modal-stale-warning" shown={reasonShown}>
          {staleWarning}
        </SubmitReason>
      )}
      {status.error === null ? null : (
        <p
          className={styles["submitStatus"]}
          data-kind="error"
          id="submit-modal-error"
          role="alert"
        >
          {status.error}
        </p>
      )}
      {noteShown ? (
        <p aria-live="polite" className={styles["submitStatus"]} role="status">
          {status.note}
        </p>
      ) : null}
    </>
  );
}
