import type { MentionCandidate } from "../../types";
import { readMentionHandle } from "../../utils";
import { MentionMark } from "./MentionMark";
import styles from "./MentionOption.module.scss";

export interface MentionOptionProps {
  candidate: MentionCandidate;
  id: string;
  active: boolean;
  onSelect: (candidate: MentionCandidate) => void;
}

/**
 * One row of the mention listbox. Focus stays in the textarea
 * (aria-activedescendant); the row is selected on mousedown, not click,
 * because click fires after the textarea's blur and blur-persist consumers
 * would race the insert.
 */
export function MentionOption({
  candidate,
  id,
  active,
  onSelect,
}: MentionOptionProps) {
  const handle = readMentionHandle(candidate);

  return (
    <div
      aria-selected={active}
      className={styles["mentionOption"]}
      data-kind={candidate.kind}
      data-state={active ? "active" : undefined}
      id={id}
      role="option"
      tabIndex={-1}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(candidate);
      }}
    >
      <MentionMark candidate={candidate} />{" "}
      <span className={styles["handle"]}>@{handle}</span>{" "}
      {candidate.name === undefined ? null : (
        <span className={styles["name"]}>{candidate.name}</span>
      )}
    </div>
  );
}
