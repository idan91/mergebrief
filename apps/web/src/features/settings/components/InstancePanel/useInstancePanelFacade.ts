import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { renderedLocale } from "../../../../i18n/locale";
import { buildSpendQueryOptions } from "../../queries";
import { isOperatorOnlyFailure } from "../../utils";
import { deriveSpendReading } from "./utils";

/**
 * The failure shows only while there is no count, and stays until one
 * arrives: a refetch with no data resets the query to pending and clears its
 * error, but keeps `errorUpdatedAt`. A failed poll over a count keeps the
 * count. A hidden panel stays mounted, so the read asks only while its tab
 * shows. An operator-only refusal replaces even a held count and settles:
 * only a config change and a restart lift it, so nothing asks again while the
 * refusal stays cached.
 */
export function useInstancePanelFacade(active: boolean) {
  const { i18n } = useTranslation();
  const spend = useQuery({
    ...buildSpendQueryOptions(),
    enabled: (query) => {
      const refusedRead = isOperatorOnlyFailure(query.state.error);
      const asks = active && !refusedRead;
      return asks;
    },
  });
  const locale = renderedLocale(i18n.resolvedLanguage);
  const [focusHandedOff, setFocusHandedOff] = useState(false);
  const handOffFocus = useCallback(() => {
    setFocusHandedOff(true);
  }, []);
  const clearFocusHandOff = useCallback(() => {
    setFocusHandedOff(false);
  }, []);

  async function retry(): Promise<boolean> {
    const result = await spend.refetch();
    const settled = result.isSuccess || isOperatorOnlyFailure(result.error);
    return settled;
  }

  const view = spend.data;
  const fetchedAt = new Date(spend.dataUpdatedAt);
  const reading =
    view === undefined
      ? undefined
      : deriveSpendReading(view, fetchedAt, locale);

  const failed = view === undefined && spend.errorUpdatedAt > 0;
  const refused = isOperatorOnlyFailure(spend.error);
  const stale =
    view !== undefined && spend.errorUpdatedAt > spend.dataUpdatedAt;

  return {
    view,
    reading,
    failed,
    refused,
    stale,
    retry,
    focusHandedOff,
    handOffFocus,
    clearFocusHandOff,
  };
}
