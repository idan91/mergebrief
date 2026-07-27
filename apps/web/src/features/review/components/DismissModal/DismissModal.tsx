import { Modal } from "@web/components/Modal/Modal";
import styles from "../ModalContent.module.scss";

export interface DismissTarget {
  flagIds: string[];
  label: string;
}

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
    <Modal open={Boolean(target)} close={cancel}>
      <h3>Dismiss flag</h3>
      <div className={styles["target"]}>{target?.label}</div>
      <textarea
        suppressHydrationWarning
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why is this flag not actionable here? Your reason lands on the receipt, verbatim."
      />
      <div
        className={styles["warn"]}
        data-state={warned ? "visible" : "hidden"}
      >
        Thin reason on a flag — it will appear on the receipt exactly as
        written. Dismiss anyway?
      </div>
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
