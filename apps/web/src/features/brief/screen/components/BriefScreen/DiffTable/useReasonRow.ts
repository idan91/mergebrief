import { useEffect, useRef, useState } from "react";

import type { DiffLine } from "@web/utils/diffTokens/types";

export interface ReasonRowState {
  openReasonRowId: string | null;
  toggleReasonRow: (rowId: string, opener: HTMLElement) => void;
  closeReasonRow: () => void;
}

/**
 * The one reason row a table has open, keyed by the row view id, and the
 * row that opened it so Close, Escape and a second toggle hand focus back.
 * The id names an index, so a new row set closes it: the row at that index
 * may be another row now.
 */
export function useReasonRow(rows: readonly DiffLine[]): ReasonRowState {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setOpenRowId(null);
    returnTo.current = null;
  }, [rows]);

  const toggleReasonRow = (rowId: string, opener: HTMLElement) => {
    if (openRowId === rowId) {
      opener.focus();
      returnTo.current = null;
      setOpenRowId(null);
      return;
    }
    returnTo.current = opener;
    setOpenRowId(rowId);
  };
  const closeReasonRow = () => {
    returnTo.current?.focus();
    returnTo.current = null;
    setOpenRowId(null);
  };

  return { openReasonRowId: openRowId, toggleReasonRow, closeReasonRow };
}
