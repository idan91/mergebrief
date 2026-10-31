import type { ClipboardEvent } from "react";

import {
  RECEIPT_FILE_INDENT,
  type ReceiptLine,
} from "../../../../utils/receipt";
import styles from "./RawReceipt.module.scss";

export interface RawReceiptProps {
  lines: readonly ReceiptLine[];
}

/**
 * A copy inside the receipt writes the selection's text content: Chromium
 * serializes each flex file line's indent and path as separate lines.
 */
function copySelectedText(event: ClipboardEvent<HTMLPreElement>) {
  const selection = document.getSelection();
  if (selection?.rangeCount !== 1) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (!event.currentTarget.contains(range.commonAncestorContainer)) {
    return;
  }

  event.clipboardData.setData("text/plain", range.toString());
  event.preventDefault();
}

/**
 * The frozen receipt as its plain text reads, a named file shortened from
 * the left so its filename stays in view. The text content is the plain
 * receipt, line breaks included, and a copy writes that text.
 */
export function RawReceipt({ lines }: RawReceiptProps) {
  const last = lines.length - 1;
  return (
    <pre className={styles["rawBody"]} onCopy={copySelectedText}>
      {lines.map((line, index) => {
        const lineBreak = index === last ? "" : "\n";
        if (typeof line === "string") {
          return `${line}${lineBreak}`;
        }
        return (
          <span className={styles["rawFileLine"]} key={index}>
            <span className={styles["rawFileIndent"]}>
              {RECEIPT_FILE_INDENT}
            </span>
            <span className={styles["rawFile"]} title={line.file}>
              <bdi dir="ltr">{line.file}</bdi>
            </span>
            {lineBreak}
          </span>
        );
      })}
    </pre>
  );
}
