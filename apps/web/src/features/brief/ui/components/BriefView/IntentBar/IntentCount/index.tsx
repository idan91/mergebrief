import { Trans } from "react-i18next";

import type { IntentCountSpec } from "../utils";
import styles from "./IntentCount.module.scss";

export interface IntentCountProps {
  count: number;
  labelKey: IntentCountSpec["labelKey"];
}

/** A neutral, uncoloured count: an alarm count reads like the others. */
export function IntentCount({ count, labelKey }: IntentCountProps) {
  const zero = count === 0 || undefined;

  return (
    <span className={styles["count"]} data-zero={zero}>
      <Trans
        components={[<b className={styles["countNum"]} key="n" />]}
        count={count}
        i18nKey={labelKey}
      />
    </span>
  );
}
