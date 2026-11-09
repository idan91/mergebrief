import { Trans, useTranslation } from "react-i18next";
import { memo } from "react";

import { Button } from "@web/components/Button";
import { ChunkStrip } from "../../../ChunkStrip";
import { GroupCardHead } from "../GroupCardHead";
import { SinceMarker } from "../SinceMarker";
import styles from "../GroupCard.module.scss";
import { deriveGroupHeadingId } from "../../../utils";
import type { GroupCardProps } from "../types";
import {
  getCategoryInlineLabel,
  getCategoryLabel,
  type AttributedGroupView,
} from "../../../../../../model/utils/view-model";
import { RiskSurface } from "../RiskSurface";
import { useAttributedGroupCardFacade } from "./useAttributedGroupCardFacade";

export interface AttributedGroupCardProps extends Omit<
  GroupCardProps,
  "group"
> {
  group: AttributedGroupView;
}

export const AttributedGroupCard = memo(function AttributedGroupCard({
  id,
  group,
  model,
  jumpToChunk,
  sinceChangedFileCount,
  sinceBaselineShortSha,
  openComparison,
}: AttributedGroupCardProps) {
  const { t } = useTranslation();
  const {
    groupFlags,
    dominant,
    isReclassified,
    dispositions,
    flagsReadOnly,
    selectedFlagSet,
    reopenFlag,
    chooseDominant,
    setDismissTarget,
    setEvidenceTarget,
    toggleRiskGroup,
  } = useAttributedGroupCardFacade({ group, model });
  const headingId = deriveGroupHeadingId(group.id);
  const showReclassify =
    group.group.uncertain && !isReclassified && !flagsReadOnly;
  const uncertainOptions = group.group.uncertainBetween.map((category) => ({
    category,
    label: getCategoryLabel(t, category),
  }));
  const between = group.group.uncertainBetween
    .map((category) => getCategoryInlineLabel(t, category))
    .join(t("brief.group.uncertainSeparator"));
  const sinceMarker =
    sinceBaselineShortSha === undefined ? undefined : (
      <SinceMarker
        baselineShortSha={sinceBaselineShortSha}
        changedFileCount={sinceChangedFileCount ?? 0}
        openComparison={openComparison}
      />
    );

  return (
    <article className={`${styles["card"]} reveal`} id={id}>
      <div className={styles["head"]}>
        <GroupCardHead
          dominant={dominant}
          group={group}
          headingId={headingId}
          isReclassified={isReclassified}
          sinceMarker={sinceMarker}
          total={model.groups.length}
        >
          {showReclassify ? (
            <div className={styles["reclassify"]}>
              <span className={styles["question"]}>
                <Trans
                  components={[<b key="between">{between}</b>]}
                  i18nKey="brief.group.splitIntent"
                />
              </span>
              <span className={styles["pick"]}>
                {uncertainOptions.map((option) => (
                  <Button
                    key={option.category}
                    size="sm"
                    onClick={() => chooseDominant(option.category)}
                  >
                    {option.label}
                  </Button>
                ))}
              </span>
            </div>
          ) : null}
        </GroupCardHead>
      </div>
      <div className={styles["stripSection"]}>
        <ChunkStrip
          chunks={group.chunks}
          groupId={group.id}
          jumpToChunk={jumpToChunk}
        />
      </div>
      <RiskSurface
        dispositions={dispositions}
        flagsReadOnly={flagsReadOnly}
        followsReader
        group={group}
        groupFlags={groupFlags}
        jumpToChunk={jumpToChunk}
        reopenFlag={reopenFlag}
        selectedFlagSet={selectedFlagSet}
        setDismissTarget={setDismissTarget}
        setEvidenceTarget={setEvidenceTarget}
        toggleRiskGroup={toggleRiskGroup}
      />
    </article>
  );
});
