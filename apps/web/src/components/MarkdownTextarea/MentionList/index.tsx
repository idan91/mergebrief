import { useTranslation } from "react-i18next";

import type { MentionCandidate } from "../types";
import { MentionOption } from "./MentionOption";
import styles from "./MentionList.module.scss";

export interface MentionListProps {
  listId: string;
  options: readonly MentionCandidate[];
  activeIndex: number;
  optionId: (index: number) => string;
  onSelect: (candidate: MentionCandidate) => void;
  /** The caller is still answering the query being typed. */
  pending: boolean;
}

/**
 * The mention popup: the listbox the textarea controls, and under it the
 * search state. The status row sits outside the listbox so its content
 * model stays options only; the live announcement rides on the editor's
 * always-mounted region, not here.
 */
export function MentionList({
  listId,
  options,
  activeIndex,
  optionId,
  onSelect,
  pending,
}: MentionListProps) {
  const { t } = useTranslation();

  return (
    <div className={styles["mentionPopup"]}>
      <div
        aria-label={t("shell.ariaLabelMentionSuggestions")}
        id={listId}
        role="listbox"
      >
        {options.map((candidate, index) => (
          <MentionOption
            active={index === activeIndex}
            candidate={candidate}
            id={optionId(index)}
            key={optionId(index)}
            onSelect={onSelect}
          />
        ))}
      </div>
      {pending ? (
        <div aria-hidden className={styles["searching"]}>
          <span className={styles["spinner"]} />
          <span>{t("shell.mentionSearching")}</span>
        </div>
      ) : null}
    </div>
  );
}
