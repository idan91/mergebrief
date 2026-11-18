import {
  RECEIPT_FILE_INDENT,
  type ReceiptLine,
} from "../../../../../utils/receipt";
import styles from "./RawReceiptLine.module.scss";

export interface RawReceiptLineProps {
  line: ReceiptLine;
  /** The last line carries no line break. */
  isLast: boolean;
}

/** One receipt line as plain text, or a named file shortened from the left. */
export function RawReceiptLine({ line, isLast }: RawReceiptLineProps) {
  const lineBreak = isLast ? "" : "\n";

  if (typeof line === "string") {
    return (
      <>
        {line}
        {lineBreak}
      </>
    );
  }
  return (
    <span className={styles["rawFileLine"]}>
      <span className={styles["rawFileIndent"]}>{RECEIPT_FILE_INDENT}</span>
      <span className={styles["rawFile"]} title={line.file}>
        <bdi dir="ltr">{line.file}</bdi>
      </span>
      {lineBreak}
    </span>
  );
}
