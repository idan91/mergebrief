import { useTranslation } from "react-i18next";

import { BranchName } from "./BranchName";
import { BranchNameVariants } from "./BranchName/types";
import { presentRef } from "./utils";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./BranchPair.module.scss";

export interface BranchPairProps {
  baseRef?: string | undefined;
  headRef?: string | undefined;
}

export function BranchPair({ baseRef, headRef }: BranchPairProps) {
  const { t } = useTranslation();
  const base = presentRef(baseRef);
  const head = presentRef(headRef);
  if (base === undefined && head === undefined) return null;

  const hasPair = base !== undefined && head !== undefined;
  const copyBase = t("brief.header.copyBaseBranch");
  const copyHead = t("brief.header.copyHeadBranch");
  const groupLabel = hasPair
    ? t("brief.header.branchPairAria", { base, head })
    : undefined;

  return (
    <span
      aria-label={groupLabel}
      className={styles["pair"]}
      data-testid="branch-pair"
      role={hasPair ? "group" : undefined}
    >
      {base !== undefined ? (
        <BranchName
          label={copyBase}
          name={base}
          variant={BranchNameVariants.BASE}
        />
      ) : null}
      {hasPair ? (
        <span aria-hidden="true" className={styles["arrow"]}>
          <Icon
            name={IconNames.ARROW_UP}
            rotation={IconRotations.THREE_QUARTERS}
            size={IconSizes.SM}
          />
        </span>
      ) : null}
      {head !== undefined ? (
        <BranchName
          label={copyHead}
          name={head}
          variant={BranchNameVariants.HEAD}
        />
      ) : null}
    </span>
  );
}
