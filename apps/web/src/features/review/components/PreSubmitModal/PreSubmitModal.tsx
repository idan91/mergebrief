import { Modal } from "../../../../components/Modal/Modal";
import type { UnresolvedItem } from "../../state";
import styles from "../ModalContent.module.scss";

export interface PreSubmitModalProps {
  close: () => void;
  continueToReceipt: () => void;
  jumpToItem: (item: UnresolvedItem) => void;
  open: boolean;
  unresolvedItems: UnresolvedItem[];
}

export function PreSubmitModal({
  close,
  continueToReceipt,
  jumpToItem,
  open,
  unresolvedItems,
}: PreSubmitModalProps) {
  return (
    <Modal open={open} boxClassName={styles["wideBox"]} close={close}>
      <h3>Before the receipt</h3>
      <p className={styles["copy"]}>
        This is advisory. You can continue, but the summary will show unresolved
        items exactly as they are.
      </p>
      <div className={styles["unresolvedList"]}>
        {unresolvedItems.length === 0 ? (
          <div className={styles["empty"]}>No unresolved review items.</div>
        ) : null}
        {unresolvedItems.map((item) => (
          <button
            className={styles["unresolvedItem"]}
            key={item.id}
            type="button"
            onClick={() => jumpToItem(item)}
          >
            <span>{unresolvedKindLabel(item.kind)}</span>
            <b>{item.label}</b>
          </button>
        ))}
      </div>
      <div className={styles["actions"]}>
        <button className="btn" type="button" onClick={close}>
          Keep reviewing
        </button>
        <button
          className="btn primary"
          type="button"
          onClick={continueToReceipt}
        >
          Continue to receipt
        </button>
      </div>
    </Modal>
  );
}

function unresolvedKindLabel(kind: UnresolvedItem["kind"]): string {
  const labels: Record<UnresolvedItem["kind"], string> = {
    "open-risk": "Open risk",
    "missing-evidence": "Addressed without evidence",
    "unreviewed-carrier": "Unreviewed carrier chunk",
    "draft-comment": "Draft comment",
    "thin-dismissal": "Thin dismissal reason",
  };
  return labels[kind];
}
