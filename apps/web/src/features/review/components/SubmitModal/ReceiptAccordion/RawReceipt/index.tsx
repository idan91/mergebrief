import type { ClipboardEvent } from "react";

import type { ReceiptLine } from "../../../../utils/receipt";
import styles from "./RawReceipt.module.scss";
import { RawReceiptLine } from "./RawReceiptLine";

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
      {lines.map((line, index) => (
        <RawReceiptLine isLast={index === last} key={index} line={line} />
      ))}
    </pre>
  );
}
