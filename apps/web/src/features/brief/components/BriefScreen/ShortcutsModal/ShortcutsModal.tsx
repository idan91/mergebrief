import type { TranslationKey } from "i18n";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button/Button";
import { Modal } from "@web/components/Modal/Modal";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { Kbd } from "../Kbd/Kbd";
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

interface ShortcutSection {
  id: string;
  headingKey: TranslationKey;
  shortcuts: ShortcutDefinition[];
}

// Esc is listed in both sections on purpose: one line says one thing.
const SECTIONS: ShortcutSection[] = [
  {
    id: "general",
    headingKey: "brief.shortcuts.sectionGeneral",
    shortcuts: [
      { key: "J", descriptionKey: "brief.shortcuts.nextChunk" },
      { key: "K", descriptionKey: "brief.shortcuts.previousChunk" },
      { key: "Shift+J", descriptionKey: "brief.shortcuts.nextGroup" },
      { key: "Shift+K", descriptionKey: "brief.shortcuts.previousGroup" },
      { key: "C", descriptionKey: "brief.shortcuts.jumpConversation" },
      { key: "S", descriptionKey: "brief.shortcuts.toggleSidebar" },
      { key: "R", descriptionKey: "brief.shortcuts.quoteThread" },
      { key: "?", descriptionKey: "brief.shortcuts.toggleShortcuts" },
      { key: "Esc", descriptionKey: "brief.shortcuts.closeDialog" },
    ],
  },
  {
    id: "focus-mode",
    headingKey: "brief.shortcuts.sectionFocusMode",
    shortcuts: [
      { key: "Z", descriptionKey: "brief.shortcuts.focusMode" },
      { key: "V", descriptionKey: "brief.shortcuts.markViewed" },
      { key: "Esc", descriptionKey: "brief.shortcuts.exitFocusMode" },
    ],
  },
];

export function ShortcutsModal({ open, close }: ShortcutsModalProps) {
  const { t } = useTranslation();
  return (
    <Modal open={open} close={close} labelledBy="shortcuts-modal-heading">
      <h2 id="shortcuts-modal-heading">{t("brief.shortcuts.heading")}</h2>
      <div className={styles["sections"]}>
        {SECTIONS.map((section) => (
          <section key={section.id}>
            <h3 className={styles["sectionHeading"]}>
              {t(section.headingKey)}
            </h3>
            {/* Key→description pairs are a definition list; <div> inside <dl>
                is valid grouping markup and keeps the row layout untouched. */}
            <dl className={styles["list"]}>
              {section.shortcuts.map((shortcut) => (
                <div className={styles["row"]} key={shortcut.key}>
                  <dt>
                    <Kbd>{shortcut.key}</Kbd>
                  </dt>
                  <dd>{t(shortcut.descriptionKey)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className={clsx(modalStyles["actions"], styles["actions"])}>
        <Button onClick={close}>{t("brief.shortcuts.close")}</Button>
      </div>
    </Modal>
  );
}
