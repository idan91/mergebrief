import { useTranslation } from "react-i18next";

import {
  getRepoConfigOutcomeLabel,
  type RepoConfigContext,
} from "../../../../../model/utils/repo-config";
import { SHORT_SHA_LENGTH } from "../../consts";
import { RiskChipDisclosure } from "../../RiskChipDisclosure";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { findAppliedSha, hasRepoConfigTrouble } from "./utils";
import styles from "./RepoConfigChip.module.scss";

export interface RepoConfigChipProps {
  repoConfig: RepoConfigContext;
}

/** The repo config's trouble chip; an ok config shows only in the details panel. */
export function RepoConfigChip({ repoConfig }: RepoConfigChipProps) {
  const { t } = useTranslation();
  if (!hasRepoConfigTrouble(repoConfig)) {
    return null;
  }

  const appliedSha = findAppliedSha(repoConfig);
  const label =
    appliedSha === undefined
      ? t("brief.header.repoConfigChip")
      : t("brief.header.repoConfigChipAt", {
          sha: appliedSha.slice(0, SHORT_SHA_LENGTH),
        });
  const { collisions } = repoConfig;
  const collisionsLine =
    collisions.length > 0
      ? t("brief.details.collisionsLine", {
          count: collisions.length,
          names: collisions.join(", "),
        })
      : undefined;
  const fileRows = repoConfig.files.map((file) => {
    const outcomeLabel = getRepoConfigOutcomeLabel(t, file.outcome);
    const shortBlobSha = file.blobSha
      ? file.blobSha.slice(0, SHORT_SHA_LENGTH)
      : undefined;
    const { bytesUsed, bytesBudget } = file;
    const hasBudget = bytesUsed !== undefined && bytesBudget !== undefined;
    const budgetLine = hasBudget
      ? t("brief.details.bytesUsed", { used: bytesUsed, budget: bytesBudget })
      : undefined;
    return { file, outcomeLabel, shortBlobSha, budgetLine };
  });

  return (
    <RiskChipDisclosure
      detail={
        <span className={styles["table"]}>
          {fileRows.map(({ file, outcomeLabel, shortBlobSha, budgetLine }) => (
            <span className={styles["row"]} key={file.path}>
              <code>{file.path}</code>
              <span data-outcome={file.outcome}>{outcomeLabel}</span>
              {shortBlobSha !== undefined ? (
                <code>@ {shortBlobSha}</code>
              ) : null}
              {budgetLine !== undefined ? <span>{budgetLine}</span> : null}
              {file.detail ? <i>{file.detail}</i> : null}
              {file.warning ? <i>{file.warning}</i> : null}
            </span>
          ))}
          {collisionsLine !== undefined ? (
            <span className={styles["row"]}>
              <i>{collisionsLine}</i>
            </span>
          ) : null}
        </span>
      }
    >
      <span
        className={styles["chip"]}
        data-repo-config-chip=""
        data-state="warning"
      >
        <Icon name={IconNames.WARNING} size={IconSizes.SM} />
        {label}
      </span>
    </RiskChipDisclosure>
  );
}
