import { useTranslation } from "react-i18next";

import type { Disposition } from "@web/features/review/session";
import { LinkButton } from "@web/components/LinkButton";
import { RiskBadge } from "../../../../../RiskBadge";
import { RiskChipDisclosure } from "../../../../../RiskChipDisclosure";
import {
  getRiskAttributeInlineLabel,
  type RiskFlag,
} from "../../../../../../../../model/utils/view-model";
import { CatalogChipDetail } from "../../CatalogChipDetail";
import { getFlagDispositionKind } from "../../utils";
import styles from "./ResolvedFlagItem.module.scss";

export interface ResolvedFlagItemProps {
  flag: RiskFlag;
  dispositions: Record<string, Disposition | undefined>;
  flagsReadOnly: boolean;
  reopenFlag: (flag: RiskFlag) => void;
}

export function ResolvedFlagItem({
  flag,
  dispositions,
  flagsReadOnly,
  reopenFlag,
}: ResolvedFlagItemProps) {
  const { t } = useTranslation();
  const kind = getFlagDispositionKind(dispositions, flag.id);
  const showReopen = kind === "dismissed" && !flagsReadOnly;
  const reopenLabel = t("brief.group.ariaLabelReopen", {
    attr: getRiskAttributeInlineLabel(t, flag.attr),
    file: flag.file,
  });
  return (
    <span className={styles["resolvedItem"]}>
      <span className={styles["resolvedChip"]}>
        <RiskChipDisclosure detail={<CatalogChipDetail flag={flag} />}>
          <RiskBadge
            attribute={flag.attr}
            meta={{ source: flag.source, deEmphasized: flag.deEmphasized }}
          />
        </RiskChipDisclosure>
      </span>
      {showReopen ? (
        <LinkButton
          aria-label={reopenLabel}
          className={styles["reopen"]}
          onClick={() => reopenFlag(flag)}
        >
          {t("brief.group.reopen")}
        </LinkButton>
      ) : null}
      {kind === "addressed" ? (
        <span className={styles["resolvedState"]}>
          {t("brief.group.addressed")}
        </span>
      ) : null}
    </span>
  );
}
