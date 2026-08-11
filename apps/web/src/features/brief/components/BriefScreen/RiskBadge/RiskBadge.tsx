import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { AttributeDisplayMeta } from "../../../utils/repoConfig";
import { Badge, BadgeColors } from "@web/components/Badge/Badge";
import styles from "./RiskBadge.module.scss";

export interface RiskBadgeProps {
  children: ReactNode;
  /**
   * Repo-policy chips get the outlined source variant plus the implication in
   * the expansion; de-emphasized chips render quiet. Absent = the plain
   * built-in chip.
   */
  meta?: AttributeDisplayMeta | undefined;
}

/**
 * @description Risk-surface token chip. Lowercase because the tokens are
 * taxonomy identifiers (the Badge default uppercases role tags). Children
 * rather than a token prop so the "+N" overflow chip shares the exact skin.
 * One chip anatomy for every source: repo-defined attributes are a VARIANT
 * of this chip (data-source), never a second chip kind.
 */
export function RiskBadge({ children, meta }: RiskBadgeProps) {
  const { t } = useTranslation();
  const repoDefined = meta?.source === "repo-policy";
  const implication = meta?.implication;
  const title = repoDefined
    ? implication !== undefined
      ? t("brief.riskBadge.repoPolicyWithImplication", { implication })
      : t("brief.riskBadge.repoPolicyLead")
    : undefined;
  return (
    <Badge
      className={styles["risk"]}
      // De-emphasis is a HUE shift (amber → neutral), never opacity — small
      // text under reduced opacity falls below 4.5:1.
      color={meta?.deEmphasized ? BadgeColors.NEUTRAL : BadgeColors.AMBER}
      dataset={{
        source: meta?.source,
        deemphasized: meta?.deEmphasized ? "" : undefined,
      }}
      title={title}
    >
      {children}
      {repoDefined ? (
        <ScreenReaderOnly>
          {implication !== undefined
            ? t("brief.riskBadge.srRepoPolicyWithImplication", { implication })
            : t("brief.riskBadge.srRepoPolicy")}
        </ScreenReaderOnly>
      ) : null}
      {meta?.deEmphasized ? (
        <ScreenReaderOnly>
          {t("brief.riskBadge.srDeEmphasized")}
        </ScreenReaderOnly>
      ) : null}
    </Badge>
  );
}
