import { useTranslation } from "react-i18next";
import type { AttributeDisplayMeta } from "../../../../model/utils/repo-config";
import { RiskBadge } from "../RiskBadge";
import { buildRepoPolicyCaption } from "../utils";
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
        const caption =
          meta === undefined ? undefined : buildRepoPolicyCaption(t, meta);
        return (
          <span className={styles["row"]} key={attr}>
            <RiskBadge attribute={attr} meta={meta} />
            {caption === undefined ? null : (
              <span className={styles["caption"]}>{caption}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}
