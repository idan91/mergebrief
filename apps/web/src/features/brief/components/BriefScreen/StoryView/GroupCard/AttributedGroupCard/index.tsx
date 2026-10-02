import { Trans, useTranslation } from "react-i18next";
import { memo } from "react";

import { Button } from "@web/components/Button";
import { ChunkStrip } from "../../../ChunkStrip";
import { GroupFacts } from "../../../GroupFacts";
import { MetaRow } from "../../../GroupFacts/MetaRow";
import { GroupFactsSurfaces } from "../../../GroupFacts/types";
import { SinceMarker } from "../SinceMarker";
import styles from "../GroupCard.module.scss";
import { deriveGroupHeadingId } from "../../../utils";
import type { GroupCardProps } from "../types";
import type { AttributedGroupView } from "../../../../../utils/viewModel";
import { RiskSurface } from "./RiskSurface";
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
  openDeltaLens,
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
  const between = group.group.uncertainBetween.join(
    t("brief.group.uncertainSeparator"),
  );
  const sinceMarker =
    sinceBaselineShortSha === undefined ? null : (
      <SinceMarker
        baselineShortSha={sinceBaselineShortSha}
        changedFileCount={sinceChangedFileCount ?? 0}
        openDeltaLens={openDeltaLens}
      />
    );

  return (
    <article className={`${styles["card"]} reveal`} id={id}>
      <div className={styles["head"]}>
        <MetaRow
          group={group}
          total={model.groups.length}
          trailing={sinceMarker}
        />
        <GroupFacts
          dominant={dominant}
          group={group}
          headingId={headingId}
          isReclassified={isReclassified}
          surface={GroupFactsSurfaces.CARD}
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
                {group.group.uncertainBetween.map((category) => (
                  <Button
                    key={category}
                    size="sm"
                    onClick={() => chooseDominant(category)}
                  >
                    {category}
                  </Button>
                ))}
              </span>
            </div>
          ) : null}
        </GroupFacts>
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
