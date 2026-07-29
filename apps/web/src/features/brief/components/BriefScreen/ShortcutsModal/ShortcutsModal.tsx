import { Modal } from "@web/components/Modal/Modal";
import styles from "./ShortcutsModal.module.scss";

export interface ShortcutsModalProps {
  open: boolean;
  close: () => void;
}

interface ShortcutDefinition {
  key: string;
  description: string;
}

const SHORTCUTS: ShortcutDefinition[] = [
  { key: "J", description: "Next chunk" },
  { key: "K", description: "Previous chunk" },
  {
    key: "Shift+J",
    description: "Next group — Read-through, in Reading order",
  },
  {
    key: "Shift+K",
    description: "Previous group — Read-through, in Reading order",
  },
  { key: "Z", description: "Focus mode — isolate the current chunk" },
  { key: "C", description: "Jump to the Conversation section (DB path)" },
  {
    key: "R",
    description: "Quote selected thread text into the reply box",
  },
  { key: "?", description: "Toggle this shortcuts list" },
  { key: "Esc", description: "Close focus mode or a dialog" },
];

export function ShortcutsModal({ open, close }: ShortcutsModalProps) {
  return (
    <Modal open={open} close={close} labelledBy="shortcuts-modal-heading">
      <h3 id="shortcuts-modal-heading">Keyboard shortcuts</h3>
      {/* Key→description pairs are a definition list; <div> inside <dl> is
          valid grouping markup and keeps the row layout untouched. */}
      <dl className={styles["list"]}>
        {SHORTCUTS.map((shortcut) => (
          <div className={styles["row"]} key={shortcut.key}>
            <dt>
              <kbd className={styles["key"]}>{shortcut.key}</kbd>
            </dt>
            <dd>{shortcut.description}</dd>
          </div>
        ))}
      </dl>
      <button className="btn" type="button" onClick={close}>
        Close
      </button>
    </Modal>
  );
}
