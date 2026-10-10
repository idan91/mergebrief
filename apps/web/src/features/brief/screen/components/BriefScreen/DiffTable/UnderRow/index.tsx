import type { ReactNode } from "react";

import { type SplitSide, SplitSides } from "@web/components/DiffRows/types";
import { EMPTY_GAP } from "../consts";
import type { UnderRowLayout } from "../types";
import { spanForPlacement } from "../utils";
import styles from "./UnderRow.module.scss";

export interface UnderRowProps {
  layout: UnderRowLayout;
  /** Under one side in the split view; absent spans the whole row. */
  placement?: SplitSide | undefined;
  conversationThread?: number | undefined;
  /** Inside a sibling span's frame, so the row carries the frame's edges. */
  spanned?: boolean;
  children: ReactNode;
}

/** A thread, composer or addressed comment under a row, on its side if any. */
export function UnderRow({
  layout,
  placement,
  conversationThread,
  spanned = false,
  children,
}: UnderRowProps) {
  const { columnCount, sideColumns } = layout;
  const beside = placement !== undefined && sideColumns !== undefined;
  const leadColumns = columnCount - (sideColumns ?? 0);

  return (
    <tr
      className={styles["row"]}
      data-conversation-thread={conversationThread}
      data-placement={beside ? placement : undefined}
      data-span={spanned ? "" : undefined}
      data-under-row=""
    >
      {beside && placement === SplitSides.RIGHT ? (
        <td className={styles["gap"]} colSpan={leadColumns}>
          {EMPTY_GAP}
        </td>
      ) : null}
      <td colSpan={beside ? spanForPlacement(placement, layout) : columnCount}>
        {children}
      </td>
      {beside && placement === SplitSides.LEFT ? (
        <td className={styles["gap"]} colSpan={sideColumns}>
          {EMPTY_GAP}
        </td>
      ) : null}
    </tr>
  );
}
