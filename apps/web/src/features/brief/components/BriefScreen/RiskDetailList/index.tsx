import { useTranslation } from "react-i18next";
import type { AttributeDisplayMeta } from "../../../utils/repoConfig";
import { RiskBadge } from "../RiskBadge";
import styles from "./RiskDetailList.module.scss";

export interface RiskDetailListProps {
  attrs: readonly string[];
  metaFor: (attr: string) => AttributeDisplayMeta | undefined;
}

/**
 * Expansion body for risk-chip disclosures. The captions are VISIBLE so
 * sighted keyboard/touch users read the same detail screen readers get inline.
 */
export function RiskDetailList({ attrs, metaFor }: RiskDetailListProps) {
  const { t } = useTranslation();
  return (
    <span className={styles["list"]}>
      {attrs.map((attr) => {
        const meta = metaFor(attr);
        const captions = [
          ...(meta?.source === "repo-policy"
            ? [
                meta.implication !== undefined
                  ? t("brief.riskBadge.repoPolicyWithImplication", {
                      implication: meta.implication,
                    })
                  : t("brief.riskBadge.repoPolicyLead"),
              ]
            : []),
          ...(meta?.deEmphasized ? [t("brief.riskBadge.deEmphasized")] : []),
        ];
        return (
          <span className={styles["row"]} key={attr}>
            <RiskBadge meta={meta}>{attr}</RiskBadge>
            {captions.length > 0 ? (
              <span className={styles["caption"]}>{captions.join(" · ")}</span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
