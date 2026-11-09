import type { HeadSummaryPart } from "../utils";
import styles from "./HeadSummary.module.scss";
import { SummaryPart } from "./SummaryPart";

export interface HeadSummaryProps {
  parts: readonly HeadSummaryPart[];
}

/** The bar head's totals, each count set apart from its noun. */
export function HeadSummary({ parts }: HeadSummaryProps) {
  return (
    <span className={styles["parts"]}>
      {parts.map((part) => (
        <span className={styles["part"]} key={part.i18nKey}>
          <SummaryPart part={part} />
        </span>
      ))}
    </span>
  );
}
