import { useLayoutEffect, useRef } from "react";

import type { StackRow } from "../types";
import { StackMemberRow } from "../StackMemberRow";
import { centreCurrentRow } from "../utils";
import styles from "./NeighbourList.module.scss";

export interface NeighbourListProps {
  rows: readonly StackRow[];
  repoSlug: string;
  repoId: string | undefined;
  /** Accessible name for the list; absent inside a labelled panel. */
  label?: string | undefined;
}

/**
 * The stack's rows in a capped scroller that opens with the current row
 * centred and keeps it pinned to an edge once scrolled away.
 */
export function NeighbourList({
  rows,
  repoSlug,
  repoId,
  label,
}: NeighbourListProps) {
  const scrollerRef = useRef<HTMLOListElement | null>(null);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) {
      centreCurrentRow(scroller);
    }
  }, []);

  return (
    <ol aria-label={label} className={styles["list"]} ref={scrollerRef}>
      {rows.map((row) => (
        <li
          className={styles["item"]}
          data-current={row.current ? "" : undefined}
          key={row.member.number}
        >
          <StackMemberRow repoId={repoId} repoSlug={repoSlug} row={row} />
        </li>
      ))}
    </ol>
  );
}
