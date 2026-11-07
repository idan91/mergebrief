import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { AuthorChip } from "@web/components/AuthorChip";
import { AuthorChipSizes } from "@web/components/AuthorChip/types";
import { LocSign, LocSigns } from "@web/components/LocSign";
import type { ProgressTotals } from "../../../utils/progress";
import type { Brief, LivePrState } from "../../../../model/types";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { BranchPair } from "../BranchPair";
import { PrRef } from "../PrRef";
import { Provenance } from "../Provenance";
import { SelfReviewChip } from "../SelfReviewChip";
import { StackNav } from "../StackNav";
import { StateBadge } from "../StateBadge";
import styles from "./LargeTitle.module.scss";

export interface LargeTitleProps {
  brief: Brief;
  model: BriefViewModel;
  repoConfig?: RepoConfigContext | null | undefined;
  livePrState?: LivePrState | undefined;
  authorLogin?: string | undefined;
  repoId?: string | undefined;
  /** The viewer's own draft: the self-review label rides with the state. */
  ownDraft: boolean;
  /** The chunk and flag counts the facts row shows. */
  totals: ProgressTotals;
  /** Hands the block to the header, which watches it scroll under the bar. */
  ref?: Ref<HTMLDivElement>;
}

/**
 * The phone's title block at the top of the page: the PR title large, then
 * its identity and how the brief was generated. The header's h1 stays the
 * page heading, so the large title text is hidden from assistive tech.
 */
export function LargeTitle({
  brief,
  model,
  repoConfig,
  livePrState,
  authorLogin,
  repoId,
  ownDraft,
  totals,
  ref,
}: LargeTitleProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["largeTitle"]} data-testid="large-title" ref={ref}>
      <p aria-hidden="true" className={styles["title"]}>
        {brief.pr.title}
      </p>
      <div className={styles["identity"]}>
        <StateBadge live={livePrState} pr={brief.pr} />
        {ownDraft ? <SelfReviewChip /> : null}
        {authorLogin !== undefined ? (
          <AuthorChip login={authorLogin} size={AuthorChipSizes.MD} />
        ) : null}
        <PrRef pr={brief.pr} />
        <StackNav brief={brief} livePrState={livePrState} repoId={repoId} />
        <BranchPair baseRef={brief.pr.baseRef} headRef={brief.pr.headRef} />
      </div>
      <dl className={styles["facts"]}>
        <div className={styles["fact"]}>
          <dt>{t("brief.mobile.factChunks", { count: totals.chunkTotal })}</dt>
          <dd>{totals.chunkTotal}</dd>
        </div>
        <div className={styles["fact"]}>
          <dt>{t("brief.mobile.factFlags", { count: totals.flagTotal })}</dt>
          <dd>{totals.flagTotal}</dd>
        </div>
        <div className={styles["fact"]}>
          <dt>{t("brief.mobile.factCoreLines")}</dt>
          <dd>
            <LocSign count={model.totalCoreAdded} sign={LocSigns.ADD} />{" "}
            <LocSign count={model.totalCoreDeleted} sign={LocSigns.DEL} />
          </dd>
        </div>
      </dl>
      <Provenance brief={brief} model={model} repoConfig={repoConfig} />
    </div>
  );
}
