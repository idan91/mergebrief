import { useTranslation } from "react-i18next";

import { CopyButton } from "@web/components/CopyButton";
import { SHORT_SHA_LENGTH } from "../../../consts";
import styles from "./ShaCopy.module.scss";

export interface ShaCopyProps {
  sha: string;
}

/** A commit's short form as a button: a click copies the full SHA. */
export function ShaCopy({ sha }: ShaCopyProps) {
  const { t } = useTranslation();
  const shortSha = sha.slice(0, SHORT_SHA_LENGTH);

  return (
    <CopyButton
      className={styles["sha"]}
      content={shortSha}
      label={t("brief.details.copySha", { sha: shortSha })}
      text={sha}
    />
  );
}
