import { Modal } from "@web/components/Modal/Modal";
import type { DismissTarget } from "../../state";
import styles from "@web/components/Modal/ModalContent.module.scss";

export interface DismissModalProps {
  target: DismissTarget | null;
  reason: string;
  warned: boolean;
  cancel: () => void;
  confirm: () => void;
  setReason: (reason: string) => void;
}

export function DismissModal({
  target,
  reason,
  warned,
  cancel,
  confirm,
  setReason,
}: DismissModalProps) {
  return (
    <Modal
      open={Boolean(target)}
      close={cancel}
      labelledBy="dismiss-modal-heading"
    >
      <h3 id="dismiss-modal-heading">Dismiss flag</h3>
      <div className={styles["target"]}>{target?.label}</div>
      <textarea
        aria-label="Dismissal reason"
        suppressHydrationWarning
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why is this flag not actionable here? Your reason lands on the receipt, verbatim."
      />
      {/* Conditionally rendered (not CSS-toggled) so its appearance is a DOM
          change role="alert" announces; visible timing is unchanged. */}
      {warned ? (
        <div className={styles["warn"]} data-state="visible" role="alert">
          Thin reason on a flag — it will appear on the receipt exactly as
          written. Dismiss anyway?
        </div>
      ) : null}
      <div className={styles["actions"]}>
        <button className="btn" type="button" onClick={cancel}>
          Cancel
        </button>
        <button className="btn primary" type="button" onClick={confirm}>
          {warned ? "Dismiss anyway" : "Dismiss with reason"}
        </button>
      </div>
    </Modal>
  );
}
