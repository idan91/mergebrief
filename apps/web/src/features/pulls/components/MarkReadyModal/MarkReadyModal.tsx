// The mark-ready soft gate (BRIEF-43; ADR 0009 #3 realized per ADR 0031).
// PreSubmitModal's SHAPE, reused deliberately — same Modal primitive (focus
// management, Escape, reduced-motion), same content stylesheet, same
// advisory/list/actions structure — but a separate concern: it gates the
// ready-for-review handoff, not a review submit.
//
// Contract (locked): lists ALL risk flags on the current head's Brief (no
// read-tracking filter — the author confronts the full surface, not the
// unread remainder); the unposted-drafts reminder line rides the modal only
// (N>0), with a jump link and NO auto-post; "Mark ready anyway" is one click
// and records nothing. The zero-flag bypass lives in the caller: the modal
// shows iff flags exist.
import { Modal } from "../../../../components/Modal/Modal";
import type { RiskFlag } from "../../../brief/viewModel";
import styles from "../../../review/components/ModalContent.module.scss";

export interface MarkReadyModalProps {
  open: boolean;
  /** ALL risk flags on the current head's Brief — never pre-filtered. */
  flags: RiskFlag[];
  unpostedDraftCount: number;
  close: () => void;
  /** One click, records nothing — runs the mark-ready mutation. */
  markReadyAnyway: () => void;
  jumpToFlag: (flag: RiskFlag) => void;
  /** Lands on the first unposted draft comment; posting stays manual. */
  jumpToDrafts: () => void;
}

export function MarkReadyModal({
  open,
  flags,
  unpostedDraftCount,
  close,
  markReadyAnyway,
  jumpToFlag,
  jumpToDrafts,
}: MarkReadyModalProps) {
  return (
    <Modal open={open} boxClassName={styles["wideBox"]} close={close}>
      <h3>Before marking ready</h3>
      <p className={styles["copy"]}>
        This is advisory. These risk flags are on the current Brief — fix and
        push (the Brief regenerates and flags drop), or mark ready as-is.
      </p>
      <div className={styles["unresolvedList"]}>
        {flags.map((flag) => (
          <button
            className={styles["unresolvedItem"]}
            key={flag.id}
            type="button"
            onClick={() => jumpToFlag(flag)}
          >
            <span>{flag.attr}</span>
            <b>{flag.file}</b>
          </button>
        ))}
      </div>
      {unpostedDraftCount > 0 ? (
        <p className={styles["copy"]}>
          <span>
            {`You have ${String(unpostedDraftCount)} unposted draft comment${unpostedDraftCount === 1 ? "" : "s"}.`}
          </span>{" "}
          <button className="btn" type="button" onClick={jumpToDrafts}>
            Jump to your drafts
          </button>
        </p>
      ) : null}
      <div className={styles["actions"]}>
        <button className="btn" type="button" onClick={close}>
          Keep self-reviewing
        </button>
        <button className="btn primary" type="button" onClick={markReadyAnyway}>
          Mark ready anyway
        </button>
      </div>
    </Modal>
  );
}
