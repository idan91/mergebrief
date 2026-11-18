import { useTranslation } from "react-i18next";

import { Icon } from "../../../../Icon";
import { IconNames, IconSizes } from "../../../../Icon/types";
import { MentionCandidateKinds, type MentionCandidate } from "../../../types";
import styles from "./MentionMark.module.scss";

export interface MentionMarkProps {
  candidate: MentionCandidate;
}

/**
 * The slot before the handle: a person's avatar, or a team glyph that also
 * names the row a team. The slot keeps its size whether or not the source
 * carried an image, so the handle column aligns across mixed rows.
 */
export function MentionMark({ candidate }: MentionMarkProps) {
  const { t } = useTranslation();

  if (candidate.kind === MentionCandidateKinds.TEAM) {
    return (
      <span className={styles["teamMark"]}>
        <Icon
          label={t("shell.mentionTeam")}
          name={IconNames.USERS}
          size={IconSizes.SM}
        />
      </span>
    );
  }
  if (candidate.avatarUrl === undefined) {
    return <span aria-hidden className={styles["avatarSlot"]} />;
  }
  // Decorative, the option text carries the identity.
  return <img alt="" className={styles["avatar"]} src={candidate.avatarUrl} />;
}
