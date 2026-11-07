import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { RiskKey } from "../../../../model/types";
import type { AttributeDisplayMeta } from "../../../../model/utils/repo-config";
import { getRiskAttributeLabel } from "../../../../model/utils/view-model";
import { Badge, BadgeColors } from "@web/components/Badge";
import styles from "./RiskBadge.module.scss";

export interface RiskBadgeProps {
  /** The attribute the chip names, shown by its display label. */
  attribute?: RiskKey;
  /** Follows the label: a count, a screen-reader note, or the +N overflow. */
  children?: ReactNode;
  /**
   * Repo-policy chips get the outlined source variant plus the implication in
   * the expansion; de-emphasized chips render quiet. Absent = the plain
   * built-in chip.
   */
  meta?: AttributeDisplayMeta | undefined;
}

function deriveRepoPolicyTitle(
  t: TFunction,
  implication: string | undefined,
): string {
  if (implication !== undefined) {
    return t("brief.riskBadge.repoPolicyWithImplication", { implication });
  }
  return t("brief.riskBadge.repoPolicyLead");
}

/**
 * Children let the +N overflow share the same chip anatomy.
 * Repo-defined attributes vary data-source, not the chip structure.
 */
export function RiskBadge({ attribute, children, meta }: RiskBadgeProps) {
  const { t } = useTranslation();
  const label =
    attribute === undefined ? undefined : getRiskAttributeLabel(t, attribute);
  const repoDefined = meta?.source === "repo-policy";
  const implication = meta?.implication;
  const title = repoDefined ? deriveRepoPolicyTitle(t, implication) : undefined;
  return (
    <Badge
      className={styles["risk"]}
      // De-emphasis is a hue shift, never opacity: small text under reduced
      // opacity falls below 4.5:1.
      color={meta?.deEmphasized ? BadgeColors.NEUTRAL : BadgeColors.AMBER}
      dataset={{
        source: meta?.source,
        deemphasized: meta?.deEmphasized ? "" : undefined,
      }}
      title={title}
    >
      {label}
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
