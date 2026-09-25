import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import { IconButton } from "../IconButton";
import { Kbd, KbdGroup } from "../Kbd";
import { REVIEW_MARK_ORDER, ReviewMarkLabelKeys } from "../ReviewMark/consts";
import { ReviewMarkGlyphs } from "../ReviewMark";
import { Modal } from "../Modal";
import { Icon } from "../Icon";
import { IconNames, IconSizes } from "../Icon/types";
import styles from "./ShortcutsModal.module.scss";

export interface ShortcutsModalProps {
  open: boolean;
  close: () => void;
  /** The screen's own bindings; the marks legend follows on every screen. */
  sections: readonly ShortcutSection[];
}

export interface ShortcutDefinition {
  keys: readonly string[];
  /** Catalog key for the binding's description. */
  descriptionKey: TranslationKey;
}

export interface ShortcutSection {
  id: string;
  headingKey: TranslationKey;
  shortcuts: ShortcutDefinition[];
}

export function ShortcutsModal({ open, close, sections }: ShortcutsModalProps) {
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
          <Icon name={IconNames.X} size={IconSizes.MD} />
        </IconButton>
      </div>
      <div className={styles["sections"]}>
        {sections.map((section) => (
          <section key={section.id}>
            <h3 className={styles["sectionHeading"]}>
              {t(section.headingKey)}
            </h3>
            {/* Key→description pairs are a definition list; <div> inside <dl>
                is valid grouping markup and keeps the row layout untouched. */}
            <dl className={styles["list"]}>
              {section.shortcuts.map((shortcut) => (
                <div
                  className={styles["row"]}
                  key={`${shortcut.descriptionKey}:${shortcut.keys.join("+")}`}
                >
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
        <section>
          <h3 className={styles["sectionHeading"]}>
            {t("brief.shortcuts.sectionMarks")}
          </h3>
          <ul className={styles["marks"]}>
            {REVIEW_MARK_ORDER.map((state) => (
              <li className={styles["mark"]} data-mark={state} key={state}>
                {ReviewMarkGlyphs[state]}
                {t(ReviewMarkLabelKeys[state])}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
