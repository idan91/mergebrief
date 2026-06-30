import { Modal } from "../../../../components/Modal/Modal";
import styles from "./ShortcutsModal.module.scss";

export interface ShortcutsModalProps {
  open: boolean;
  close: () => void;
}

const SHORTCUTS: { key: string; description: string }[] = [
  { key: "J", description: "Next chunk" },
  { key: "K", description: "Previous chunk" },
  { key: "Z", description: "Focus mode — isolate the current chunk" },
  { key: "?", description: "Toggle this shortcuts list" },
  { key: "Esc", description: "Close focus mode or a dialog" },
];

export function ShortcutsModal({ open, close }: ShortcutsModalProps) {
  return (
    <Modal open={open} close={close}>
      <h3>Keyboard shortcuts</h3>
      <div className={styles["list"]}>
        {SHORTCUTS.map((shortcut) => (
          <div className={styles["row"]} key={shortcut.key}>
            <span className={styles["key"]}>{shortcut.key}</span>
            <span>{shortcut.description}</span>
          </div>
        ))}
      </div>
      <button className="btn" type="button" onClick={close}>
        Close
      </button>
    </Modal>
  );
}
