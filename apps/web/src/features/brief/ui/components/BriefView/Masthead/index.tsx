import type { ReactNode } from "react";

import { BarGroup } from "@web/components/CollapsibleBar/BarGroup";
import { MediaLightboxScope } from "@web/components/Markdown/context";
import type { Brief } from "../../../../model/types";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { GeneratedBar } from "./GeneratedBar";
import { useMediaGallery } from "./MediaStrip/useMediaGallery";
import { OriginalDescription } from "./OriginalDescription";
import { SplitBar } from "./SplitBar";
import { StatsCard } from "./StatsCard";
import { Summary } from "./Summary";
import { useHeldCardHeight } from "./useHeldCardHeight";
import { computeConcernShares, hasConcernSplit } from "./utils";
import styles from "./Masthead.module.scss";

export interface MastheadProps {
  brief: Brief;
  model: BriefViewModel;
  repoConfig?: RepoConfigContext | null | undefined;
  /** The fold rows after Original description, in reading order. */
  children: ReactNode;
}

/**
 * The brief's opening: the summary over one group of folds on the story's
 * diff column, the stats card on its card column. The card reaches at least
 * the closed folds' bottom and keeps that height while a fold is open; under
 * a card taller on its own the folds move down to end on its bottom edge.
 * Where the story stacks there is no card: its sections lead the column as
 * one group of fact rows instead.
 */
export function Masthead({
  brief,
  model,
  repoConfig,
  children,
}: MastheadProps) {
  const { gridRef, summaryRef, cardRef, stackRef } = useHeldCardHeight();
  const gallery = useMediaGallery(brief);
  const shares = computeConcernShares(brief.concernView, model.unattributed);
  const showSplit = hasConcernSplit(shares);

  return (
    <div className={styles["grid"]} data-testid="masthead" ref={gridRef}>
      <div className={styles["summary"]} ref={summaryRef}>
        <Summary brief={brief} gallery={gallery} />
      </div>
      <StatsCard
        brief={brief}
        className={styles["card"]}
        model={model}
        ref={cardRef}
        repoConfig={repoConfig}
        shares={shares}
      />
      <div className={styles["stack"]} ref={stackRef}>
        <BarGroup className={styles["facts"]} testId="masthead-facts">
          <div className={styles["generatedRow"]}>
            <GeneratedBar brief={brief} model={model} repoConfig={repoConfig} />
          </div>
          {showSplit ? (
            <div className={styles["splitRow"]}>
              <SplitBar shares={shares} />
            </div>
          ) : null}
        </BarGroup>
        <BarGroup testId="masthead-folds">
          <MediaLightboxScope value={gallery.lightbox}>
            <OriginalDescription description={brief.pr.description} />
          </MediaLightboxScope>
          {children}
        </BarGroup>
      </div>
    </div>
  );
}
