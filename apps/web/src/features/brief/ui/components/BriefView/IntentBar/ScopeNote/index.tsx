import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { InlineCodeText } from "../../InlineCodeText";
import styles from "./ScopeNote.module.scss";

export interface ScopeNoteProps {
  /** The model's one sentence on how the sources span beyond this PR. */
  note: string;
}

/** The scope note, marked as a stack fact: the model writes one only for a stacked series. */
export function ScopeNote({ note }: ScopeNoteProps) {
  return (
    <div className={styles["note"]} role="note">
      <span className={styles["mark"]}>
        <Icon name={IconNames.STACK} size={IconSizes.LG} />
      </span>
      <p className={styles["text"]}>
        <InlineCodeText text={note} />
      </p>
    </div>
  );
}
