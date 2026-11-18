import type { LocalBriefSummary } from "contract";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import {
  Chip,
  ChipElements,
  ChipTones,
  ChipVariants,
} from "@web/components/Chip";
import { getArtifactKindLabel } from "../../../../model/utils/view-model";
import styles from "./LocalBriefRow.module.scss";
import { describeLocalBriefRevision } from "./utils";

export interface LocalBriefRowProps {
  brief: LocalBriefSummary;
}

/** An Inbox row's two lines for a file artifact: title and kind, then repository, number and revision. */
export function LocalBriefRow({ brief }: LocalBriefRowProps) {
  const { t } = useTranslation();
  const kind = getArtifactKindLabel(t, brief.artifactKind);
  const revision = describeLocalBriefRevision(brief);

  return (
    <li className={styles["row"]} data-testid="local-brief-row">
      <Link
        className={styles["main"]}
        params={{ briefId: brief.id }}
        to="/briefs/$briefId"
      >
        <span className={styles["title"]}>
          <span className={styles["titleText"]}>{brief.title}</span>{" "}
          <Chip
            as={ChipElements.SPAN}
            className={styles["chip"]}
            tone={ChipTones.MUTED}
            variant={ChipVariants.FACT}
          >
            {kind}
          </Chip>
        </span>
        <span className={styles["sub"]}>
          <span className={styles["repo"]}>{brief.repo}</span>{" "}
          <span>{t("home.inbox.number", { number: brief.number })}</span>{" "}
          <span className={styles["revision"]}>{revision}</span>
        </span>
      </Link>
    </li>
  );
}
