import { Trans } from "react-i18next";

import type { HeadSummaryPart } from "../../utils";
import styles from "./SummaryPart.module.scss";

export interface SummaryPartProps {
  part: HeadSummaryPart;
}

/**
 * One total with its count in its own slot. The counts go in as text: Trans
 * drops a self-closing slot's numeric child when it is 0.
 */
export function SummaryPart({ part }: SummaryPartProps) {
  const countText = String(part.count);
  const openText = part.open === undefined ? undefined : String(part.open);

  return (
    <Trans
      components={[
        <b className={styles["count"]} key="count">
          {countText}
        </b>,
        <b className={styles["count"]} key="open">
          {openText}
        </b>,
      ]}
      count={part.count}
      i18nKey={part.i18nKey}
    />
  );
}
