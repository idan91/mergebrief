import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button/Button";
import { Modal } from "@web/components/Modal/Modal";
import styles from "./ShortcutsModal.module.scss";

export interface ShortcutsModalProps {
  open: boolean;
  close: () => void;
}

interface ShortcutDefinition {
  key: string;
  /** Catalog key for the binding's description. */
  descriptionKey: TranslationKey;
}

const SHORTCUTS: ShortcutDefinition[] = [
  { key: "J", descriptionKey: "brief.shortcuts.nextChunk" },
  { key: "K", descriptionKey: "brief.shortcuts.previousChunk" },
  { key: "Shift+J", descriptionKey: "brief.shortcuts.nextGroup" },
  { key: "Shift+K", descriptionKey: "brief.shortcuts.previousGroup" },
  { key: "Z", descriptionKey: "brief.shortcuts.focusMode" },
  { key: "V", descriptionKey: "brief.shortcuts.markViewed" },
  { key: "C", descriptionKey: "brief.shortcuts.jumpConversation" },
  { key: "R", descriptionKey: "brief.shortcuts.quoteThread" },
  { key: "?", descriptionKey: "brief.shortcuts.toggleShortcuts" },
  { key: "Esc", descriptionKey: "brief.shortcuts.closeDialog" },
];

export function ShortcutsModal({ open, close }: ShortcutsModalProps) {
  const { t } = useTranslation();
  return (
    <Modal open={open} close={close} labelledBy="shortcuts-modal-heading">
      <h2 id="shortcuts-modal-heading">{t("brief.shortcuts.heading")}</h2>
      {/* Key→description pairs are a definition list; <div> inside <dl> is
          valid grouping markup and keeps the row layout untouched. */}
      <dl className={styles["list"]}>
        {SHORTCUTS.map((shortcut) => (
          <div className={styles["row"]} key={shortcut.key}>
            <dt>
              <kbd className={styles["key"]}>{shortcut.key}</kbd>
            </dt>
            <dd>{t(shortcut.descriptionKey)}</dd>
          </div>
        ))}
      </dl>
      <Button onClick={close}>{t("brief.shortcuts.close")}</Button>
    </Modal>
  );
}
