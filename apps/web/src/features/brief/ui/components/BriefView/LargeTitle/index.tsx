import type { Ref } from "react";

import { AuthorChip } from "@web/components/AuthorChip";
import { AuthorChipSizes } from "@web/components/AuthorChip/types";
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
  ref,
}: LargeTitleProps) {
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
      <Provenance brief={brief} model={model} repoConfig={repoConfig} />
    </div>
  );
}
