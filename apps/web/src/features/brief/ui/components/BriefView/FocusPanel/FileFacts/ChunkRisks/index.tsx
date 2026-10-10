import { useTranslation } from "react-i18next";

import type { BriefChunk } from "../../../../../../model/types";
import type { AttributeDisplayMeta } from "../../../../../../model/utils/repoConfig";
import { RiskBadge } from "../../../RiskBadge";
import { RiskChipDisclosure } from "../../../RiskChipDisclosure";
import { RiskDetailList } from "../../../RiskDetailList";
import { isDisclosedRisk } from "../../utils";
import styles from "./ChunkRisks.module.scss";

export interface ChunkRisksProps {
  chunk: BriefChunk;
  riskMeta: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
}

export function ChunkRisks({ chunk, riskMeta }: ChunkRisksProps) {
  const { t } = useTranslation();
  const hasRisks = chunk.riskSurface.length > 0;

  return (
    <>
      <h4 className={styles["label"]}>{t("brief.focusPanel.activeRisks")}</h4>
      {hasRisks ? (
        <div className={styles["risks"]}>
          {chunk.riskSurface.map((risk) => {
            const meta = riskMeta?.get(risk);
            if (!isDisclosedRisk(meta)) {
              return (
                <RiskBadge key={risk} meta={meta}>
                  {risk}
                </RiskBadge>
              );
            }
            return (
              <RiskChipDisclosure
                detail={<RiskDetailList attrs={[risk]} metaFor={() => meta} />}
                key={risk}
              >
                <RiskBadge meta={meta}>{risk}</RiskBadge>
              </RiskChipDisclosure>
            );
          })}
        </div>
      ) : (
        <p className={styles["noRisks"]}>{t("brief.focusPanel.noRisks")}</p>
      )}
    </>
  );
}
