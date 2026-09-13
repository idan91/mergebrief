import { Trans, useTranslation } from "react-i18next";
import { memo } from "react";

import { CoreLinesDisclosure } from "../../../CoreLinesDisclosure/CoreLinesDisclosure";
import { SinceMarker } from "../SinceMarker/SinceMarker";
import { Button } from "@web/components/Button/Button";
import { LocSign, LocSigns } from "@web/components/LocSign/LocSign";
import styles from "../GroupCard.module.scss";
import { deriveGroupHeadingId } from "../../../utils";
import type { GroupCardProps } from "../types";
import type { AttributedGroupView } from "../../../../../utils/viewModel";
import { RiskSurface } from "./RiskSurface/RiskSurface";
import { useAttributedGroupCardFacade } from "./useAttributedGroupCardFacade";

export interface AttributedGroupCardProps extends Omit<
  GroupCardProps,
  "group"
> {
  group: AttributedGroupView;
}

export const AttributedGroupCard = memo(function AttributedGroupCard({
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

  return (
    <article className={`${styles["card"]} reveal`}>
      <div className={styles["head"]}>
        <div className={styles["eyebrow"]}>
          <span className={styles["number"]}>
            {t("brief.group.changeGroupOf", {
              index: group.index + 1,
              total: model.groups.length,
            })}
          </span>
          <div className={styles["metrics"]}>
            <CoreLinesDisclosure
              allAdded={group.added}
              allDeleted={group.deleted}
              className={styles["loc"]}
              coreAdded={group.coreAdded}
              coreDeleted={group.coreDeleted}
            >
              <LocSign sign={LocSigns.ADD} count={group.coreAdded} /> /{" "}
              <LocSign sign={LocSigns.DEL} count={group.coreDeleted} />{" "}
              {t("brief.group.coreSuffix")} ·{" "}
              {t("brief.group.chunkCounts", {
                core: group.coreChunks.length,
                supporting: group.supportingChunks.length,
              })}
            </CoreLinesDisclosure>
            {sinceBaselineShortSha !== undefined ? (
              <SinceMarker
                baselineShortSha={sinceBaselineShortSha}
                changedFileCount={sinceChangedFileCount ?? 0}
                openDeltaLens={openDeltaLens}
              />
            ) : null}
          </div>
        </div>
        <h2
          className={styles["title"]}
          id={deriveGroupHeadingId(group.id)}
          tabIndex={-1}
        >
          {group.group.title}
        </h2>
        <p className={styles["summary"]}>{group.group.summary}</p>
        {group.readingOrderStep !== undefined ? (
          <p className={styles["readingOrder"]}>
            {t("brief.group.stepOf", {
              step: group.readingOrderStep,
              total: model.groups.length,
            })}
            {group.readingOrderWhy ? ` — ${group.readingOrderWhy}` : ""}
          </p>
        ) : null}
        <div className={styles["categoryRow"]}>
          <span className={styles["chip"]} data-kind="dominant">
            <em>{t("brief.group.dominant")}</em> {dominant}
          </span>
          {group.group.secondaryCategories.map((category) => (
            <span className={styles["chip"]} key={category}>
              {t("brief.group.secondary", { category })}
            </span>
          ))}
          {group.group.uncertain && !isReclassified ? (
            <span className={styles["chip"]} data-kind="uncertain">
              {t("brief.group.uncertain")}
            </span>
          ) : null}
          {isReclassified ? (
            <span className={styles["reclassNote"]}>
              {t("brief.group.reclassNote")}
            </span>
          ) : null}
        </div>
        {group.group.uncertain && !isReclassified && !flagsReadOnly ? (
          <div className={styles["uncertainPanel"]}>
            <span className={styles["question"]}>
              <Trans
                components={[
                  <b key="between">
                    {group.group.uncertainBetween.join(
                      t("brief.group.uncertainSeparator"),
                    )}
                  </b>,
                ]}
                i18nKey="brief.group.splitIntent"
              />
            </span>
            <span className={styles["pick"]}>
              {group.group.uncertainBetween.map((category) => (
                <Button key={category} onClick={() => chooseDominant(category)}>
                  {category}
                </Button>
              ))}
            </span>
          </div>
        ) : null}
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
