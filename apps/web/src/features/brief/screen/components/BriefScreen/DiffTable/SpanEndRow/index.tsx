import { EMPTY_GAP } from "../consts";
import styles from "./SpanEndRow.module.scss";

export interface SpanEndRowProps {
  columnCount: number;
}

/** The rule that closes a sibling span's frame under its last row. */
export function SpanEndRow({ columnCount }: SpanEndRowProps) {
  return (
    <tr aria-hidden="true" className={styles["row"]}>
      <td colSpan={columnCount}>{EMPTY_GAP}</td>
    </tr>
  );
}
