import { Trans, useTranslation } from "react-i18next";

import { CONFIG_FILE } from "@web/utils/instance-config";
import { EXAMPLE_CAP } from "../consts";
import { buildSpendBlock } from "./utils";
import styles from "./CapConfig.module.scss";

export interface CapConfigProps {
  /** Absent on an uncapped Instance: the block offers to add one. */
  cap: number | undefined;
}

export function CapConfig({ cap }: CapConfigProps) {
  const { t } = useTranslation();
  const heading = cap === undefined ? t("spend.addCap") : t("spend.changeCap");
  const spendBlock = buildSpendBlock(cap ?? EXAMPLE_CAP);

  return (
    <div className={styles["block"]}>
      <h3 className={styles["heading"]}>{heading}</h3>
      <p className={styles["copy"]}>
        <Trans
          components={[<code key="file">{CONFIG_FILE}</code>]}
          i18nKey="spend.configCopy"
        />
      </p>
      <pre className={styles["code"]}>
        <code>{spendBlock}</code>
      </pre>
    </div>
  );
}
