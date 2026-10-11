import { useTranslation } from "react-i18next";
import clsx from "clsx";

import type { Brief } from "../../../../../model/types";
import type { RepoConfigContext } from "../../../../../model/utils/repo-config";
import type { BriefViewModel } from "../../../../../model/utils/view-model";
import { Provenance } from "../../Provenance";
import { CoverageLine } from "../CoverageLine";
import type { ConcernShare } from "../types";
import { hasConcernSplit } from "../utils";
import { SplitRows } from "./SplitRows";
import styles from "./StatsCard.module.scss";

export interface StatsCardProps {
  brief: Brief;
  model: BriefViewModel;
  repoConfig?: RepoConfigContext | null | undefined;
  shares: readonly ConcernShare[];
  className?: string | undefined;
}

/** The masthead's card: how the brief was generated, then the concern Split. */
export function StatsCard({
  brief,
  model,
  repoConfig,
  shares,
  className,
}: StatsCardProps) {
  const { t } = useTranslation();
  const showSplit = hasConcernSplit(shares);
  const cardClassName = clsx(styles["card"], className);

  return (
    <div className={cardClassName} data-testid="stats-card">
      <section className={styles["section"]}>
        <h2 className={styles["label"]}>{t("brief.masthead.generatedBy")}</h2>
        <Provenance brief={brief} model={model} repoConfig={repoConfig} />
        <CoverageLine brief={brief} />
      </section>
      {showSplit ? (
        <section className={styles["section"]}>
          <h2 className={styles["label"]}>{t("brief.masthead.split")}</h2>
          <SplitRows shares={shares} />
        </section>
      ) : null}
    </div>
  );
}
