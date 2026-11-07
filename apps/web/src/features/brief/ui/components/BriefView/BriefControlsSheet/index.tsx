import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { BottomSheet } from "@web/components/BottomSheet";
import { LocSign, LocSigns } from "@web/components/LocSign";
import { ToolbarButton } from "@web/components/ToolbarButton";
import { AccountMenu } from "@web/features/account";
import type {
  BriefSearch,
  CompareOptionFlags,
} from "../../../../model/comparison/compare-state";
import type { Brief } from "../../../../model/types";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import type { ProgressTotals } from "../../../utils/progress";
import { ComparisonControls } from "../ComparisonControls";
import { MarkReadyCta } from "../MarkReadyCta";
import { SubmitReviewCta } from "../SubmitReviewCta";
import type { OwnDraftHeaderProps } from "../types";
import { deriveStatFigures, findCountedRemainder } from "../stats";
import { Provenance } from "../Provenance";
import type { ReadingToolbarProps } from "../ReadingToolbar";
import { ChangeStepper } from "../ChangeStepper";
import { COLLAPSE_PRESSED } from "../consts";
import { FilterDisclosure } from "../FilterDisclosure";
import { RiskAttrsDisclosure } from "../RiskAttrsDisclosure";
import styles from "./BriefControlsSheet.module.scss";

export interface BriefControlsSheetProps {
  brief: Brief;
  briefId: string;
  model: BriefViewModel;
  totals: ProgressTotals;
  repoConfig?: RepoConfigContext | null | undefined;
  availability: CompareOptionFlags;
  compareState: BriefSearch;
  /** The DB route's compare controls and notices, in place of the local ones. */
  controlsSlot?: ReactNode | undefined;
  ownDraft?: OwnDraftHeaderProps | undefined;
  openSubmit: () => void;
  draftCommentCount: number;
  toggleShortcuts: () => void;
  /**
   * The reading toolbar's controls, which the sheet shows in its place on
   * phones; absent where the toolbar region is hidden.
   */
  toolbar?:
    | Pick<
        ReadingToolbarProps,
        | "filter"
        | "rail"
        | "jumpToGroup"
        | "riskAttrCycle"
        | "supportingCollapse"
        | "toggleCollapseSupporting"
        | "startReadThrough"
        | "comparison"
        | "revisionNav"
      >
    | undefined;
  close: () => void;
}

/**
 * The phone's Brief controls: what the sticky header and the reading toolbar
 * hold on a desktop, as one sheet. Every control is the shared one; a jump
 * closes the sheet first so the page is in view when it lands.
 */
export function BriefControlsSheet({
  brief,
  briefId,
  model,
  totals,
  repoConfig,
  availability,
  compareState,
  controlsSlot,
  ownDraft,
  openSubmit,
  draftCommentCount,
  toggleShortcuts,
  toolbar,
  close,
}: BriefControlsSheetProps) {
  const { t } = useTranslation();
  const remainderGroup = findCountedRemainder(model);
  const statFigures = deriveStatFigures(totals, ownDraft !== undefined);

  const makeCloseThenRun = (action: () => void) => () => {
    close();
    action();
  };
  const jumpToGroup = (groupId: string) => {
    close();
    toolbar?.jumpToGroup(groupId);
  };
  const startReadThroughFromSheet = makeCloseThenRun(() =>
    toolbar?.startReadThrough?.(),
  );
  const jumpNextFromSheet = makeCloseThenRun(() =>
    toolbar?.revisionNav.jumpNext(),
  );
  const jumpPrevFromSheet = makeCloseThenRun(() =>
    toolbar?.revisionNav.jumpPrev(),
  );
  const submitFromSheet = makeCloseThenRun(openSubmit);
  const sheetOwnDraft =
    ownDraft === undefined
      ? undefined
      : { ...ownDraft, markReady: makeCloseThenRun(ownDraft.markReady) };

  return (
    <BottomSheet
      close={close}
      closeLabel={t("brief.mobile.closeBriefControls")}
      label={t("brief.mobile.briefControls")}
      testId="brief-controls-sheet"
    >
      <div className={styles["body"]}>
        <div className={styles["account"]}>
          <span className={styles["accountLabel"]}>
            {t("brief.mobile.account")}
          </span>
          <AccountMenu onOpenShortcuts={toggleShortcuts} />
        </div>
        <div className={styles["comparison"]}>
          {controlsSlot ?? (
            <ComparisonControls
              availability={availability}
              briefId={briefId}
              compareState={compareState}
            />
          )}
        </div>
        <dl className={styles["stats"]}>
          <div className={styles["stat"]}>
            <dt>{t("brief.header.coreLines")}</dt>
            <dd>
              <LocSign count={model.totalCoreAdded} sign={LocSigns.ADD} />{" "}
              <LocSign count={model.totalCoreDeleted} sign={LocSigns.DEL} />
            </dd>
          </div>
          {remainderGroup === undefined ? null : (
            <div className={styles["stat"]}>
              <dt>{t("brief.unattributed.label")}</dt>
              <dd>
                <LocSign count={remainderGroup.added} sign={LocSigns.ADD} />{" "}
                <LocSign count={remainderGroup.deleted} sign={LocSigns.DEL} />
              </dd>
            </div>
          )}
          <div className={styles["stat"]}>
            <dt>{t("brief.header.chunks")}</dt>
            <dd>{statFigures.chunks}</dd>
          </div>
          <div className={styles["stat"]}>
            <dt>{t("brief.header.flags")}</dt>
            <dd>{statFigures.flags}</dd>
          </div>
          <div className={styles["stat"]}>
            <dt>{t("brief.masthead.generatedBy")}</dt>
            <dd>
              <Provenance brief={brief} model={model} repoConfig={repoConfig} />
            </dd>
          </div>
        </dl>
        {toolbar === undefined ? null : (
          <div className={styles["actions"]}>
            {toolbar.filter === undefined ? null : (
              <div className={styles["actionRow"]}>
                <span>{t("brief.mobile.filterThreads")}</span>
                <FilterDisclosure
                  filter={toolbar.filter.filter}
                  hiddenInlineThreads={toolbar.filter.hiddenInlineThreads}
                  reviewers={toolbar.filter.reviewers}
                  sheet
                  verdicts={toolbar.filter.verdicts}
                  onChange={toolbar.filter.onChange}
                />
              </div>
            )}
            {toolbar.rail.entries.length === 0 ? null : (
              <div className={styles["actionRow"]}>
                <RiskAttrsDisclosure
                  cycle={toolbar.riskAttrCycle}
                  jumpToGroup={jumpToGroup}
                  rail={toolbar.rail}
                  sheet
                />
              </div>
            )}
            <div className={styles["actionRow"]}>
              {toolbar.startReadThrough === undefined ? null : (
                <ToolbarButton onClick={startReadThroughFromSheet}>
                  {t("brief.toolbar.startReadThrough")}
                </ToolbarButton>
              )}
              <ToolbarButton
                aria-pressed={COLLAPSE_PRESSED[toolbar.supportingCollapse]}
                onClick={toolbar.toggleCollapseSupporting}
              >
                {t("brief.toolbar.collapseLong")}
              </ToolbarButton>
            </div>
            <ChangeStepper
              comparison={toolbar.comparison}
              jumpNext={jumpNextFromSheet}
              jumpPrev={jumpPrevFromSheet}
              sheet
            />
          </div>
        )}
        <div className={styles["submit"]}>
          {sheetOwnDraft === undefined ? (
            <SubmitReviewCta
              count={draftCommentCount}
              onClick={submitFromSheet}
            />
          ) : (
            <MarkReadyCta ownDraft={sheetOwnDraft} />
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
