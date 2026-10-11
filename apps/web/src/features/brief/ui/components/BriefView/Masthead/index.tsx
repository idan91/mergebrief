import type { ReactNode } from "react";

import type { Brief } from "../../../../model/types";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { StatsCard } from "./StatsCard";
import { Summary } from "./Summary";
import { useHeldCardHeight } from "./useHeldCardHeight";
import { computeConcernShares } from "./utils";
import styles from "./Masthead.module.scss";

export interface MastheadProps {
  brief: Brief;
  model: BriefViewModel;
  repoConfig?: RepoConfigContext | null | undefined;
  /** The bars under the summary, in reading order. */
  children: ReactNode;
}

/**
 * The brief's opening: the summary over a stack of bars on the story's diff
 * column, the stats card on its card column. The card runs from the
 * summary's top to the last closed bar's bottom and keeps that height while
 * a bar is open.
 */
export function Masthead({
  brief,
  model,
  repoConfig,
  children,
}: MastheadProps) {
  const { gridRef, summaryRef, stackRef } = useHeldCardHeight();
  const shares = computeConcernShares(brief.concernView, model.unattributed);

  return (
    <div className={styles["grid"]} data-testid="masthead" ref={gridRef}>
      <div className={styles["summary"]} ref={summaryRef}>
        <Summary brief={brief} />
      </div>
      <StatsCard
        brief={brief}
        className={styles["card"]}
        model={model}
        repoConfig={repoConfig}
        shares={shares}
      />
      <div className={styles["stack"]} ref={stackRef}>
        {children}
      </div>
    </div>
  );
}
