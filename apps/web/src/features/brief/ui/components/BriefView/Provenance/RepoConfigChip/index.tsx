import { useTranslation } from "react-i18next";

import type { RepoConfigContext } from "../../../../../model/utils/repo-config";
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

  return (
    <RiskChipDisclosure
      detail={
        <span className={styles["table"]}>
          {repoConfig.files.map((file) => (
            <span className={styles["row"]} key={file.path}>
              <code>{file.path}</code>
              <span data-outcome={file.outcome}>{file.outcome}</span>
              {file.blobSha ? (
                <code>@ {file.blobSha.slice(0, SHORT_SHA_LENGTH)}</code>
              ) : null}
              {file.bytesUsed !== undefined &&
              file.bytesBudget !== undefined ? (
                <span>
                  {t("brief.details.bytesUsed", {
                    used: file.bytesUsed,
                    budget: file.bytesBudget,
                  })}
                </span>
              ) : null}
              {file.detail ? <i>{file.detail}</i> : null}
              {file.warning ? <i>{file.warning}</i> : null}
            </span>
          ))}
          {repoConfig.collisions.length > 0 ? (
            <span className={styles["row"]}>
              <i>
                {t("brief.details.collisionsLine", {
                  count: repoConfig.collisions.length,
                  names: repoConfig.collisions.join(", "),
                })}
              </i>
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
