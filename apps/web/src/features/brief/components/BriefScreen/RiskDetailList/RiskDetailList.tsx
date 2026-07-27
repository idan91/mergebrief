import type { AttributeDisplayMeta } from "../../../utils/repoConfig";
import { RiskBadge } from "../RiskBadge/RiskBadge";
import styles from "./RiskDetailList.module.scss";

export interface RiskDetailListProps {
  attrs: readonly string[];
  metaFor: (attr: string) => AttributeDisplayMeta | undefined;
}

/**
 * Expansion body for risk-chip disclosures (BRIEF-52): each attribute as a
 * chip plus a VISIBLE caption for repo-defined ones ("Defined by repo policy
 * — implication") and de-emphasized ones — sighted keyboard/touch users read
 * the same detail screen readers get inline (codex r7).
 */
export function RiskDetailList({ attrs, metaFor }: RiskDetailListProps) {
  return (
    <span className={styles["list"]}>
      {attrs.map((attr) => {
        const meta = metaFor(attr);
        const captions = [
          ...(meta?.source === "repo-policy"
            ? [
                `Defined by repo policy${meta.implication ? ` — ${meta.implication}` : ""}`,
              ]
            : []),
          ...(meta?.deEmphasized ? ["De-emphasized by repo policy"] : []),
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
