import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import { IconButton } from "@web/components/IconButton/IconButton";
import { Modal } from "@web/components/Modal/Modal";
import { Kbd, KbdGroup } from "../Kbd/Kbd";
import CloseIcon from "./icons/close.svg?react";
import styles from "./ShortcutsModal.module.scss";

export interface ShortcutsModalProps {
  open: boolean;
  close: () => void;
}

interface ShortcutDefinition {
  keys: readonly string[];
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
      { keys: ["J"], descriptionKey: "brief.shortcuts.nextChunk" },
      { keys: ["K"], descriptionKey: "brief.shortcuts.previousChunk" },
      { keys: ["Shift", "J"], descriptionKey: "brief.shortcuts.nextGroup" },
      { keys: ["Shift", "K"], descriptionKey: "brief.shortcuts.previousGroup" },
      { keys: ["C"], descriptionKey: "brief.shortcuts.jumpConversation" },
      { keys: ["S"], descriptionKey: "brief.shortcuts.toggleSidebar" },
      { keys: ["R"], descriptionKey: "brief.shortcuts.quoteThread" },
      { keys: ["?"], descriptionKey: "brief.shortcuts.toggleShortcuts" },
      { keys: ["Esc"], descriptionKey: "brief.shortcuts.closeDialog" },
    ],
  },
  {
    id: "focus-mode",
    headingKey: "brief.shortcuts.sectionFocusMode",
    shortcuts: [
      { keys: ["Z"], descriptionKey: "brief.shortcuts.focusMode" },
      { keys: ["V"], descriptionKey: "brief.shortcuts.markViewed" },
      { keys: ["Esc"], descriptionKey: "brief.shortcuts.exitFocusMode" },
    ],
  },
];

export function ShortcutsModal({ open, close }: ShortcutsModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      boxClassName={styles["box"]}
      close={close}
      labelledBy="shortcuts-modal-heading"
      open={open}
    >
      <div className={styles["header"]}>
        <h2 id="shortcuts-modal-heading">{t("brief.shortcuts.heading")}</h2>
        <IconButton
          label={t("brief.shortcuts.close")}
          size="md"
          onClick={close}
        >
          <CloseIcon aria-hidden="true" />
        </IconButton>
      </div>
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
                <div className={styles["row"]} key={shortcut.descriptionKey}>
                  <dt>
                    <KbdGroup>
                      {shortcut.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  </dt>
                  <dd>{t(shortcut.descriptionKey)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
