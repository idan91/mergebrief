import { useId } from "react";
import { useTranslation } from "react-i18next";
import { formatDisplayPath } from "brief-core/hidden-chars";
import { RiskSurfaceAttributes } from "brief-core/types";
import { RiskBadge } from "../../RiskBadge";
import styles from "./PackageSourceFiles.module.scss";

export interface PackageSourceFilesProps {
  /** Flagged files no delta chunk covers, in the Delta Brief's order. */
  files: readonly string[];
}

/** The package-source flag's files a Delta Brief carries with no chunk. */
export function PackageSourceFiles({ files }: PackageSourceFilesProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const fileRows = files.map((file) => ({
    file,
    displayFile: formatDisplayPath(file),
  }));
  return (
    <section aria-labelledby={labelId}>
      <div className={styles["eyebrow"]} id={labelId}>
        <RiskBadge attribute={RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE} />
      </div>
      <p>{t("brief.delta.packageSourceFilesNote")}</p>
      <ul className={styles["files"]}>
        {fileRows.map(({ file, displayFile }) => (
          <li key={file}>
            <bdi>{displayFile}</bdi>
          </li>
        ))}
      </ul>
    </section>
  );
}
