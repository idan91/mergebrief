import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button/Button";
import { EmptyBlock } from "@web/components/EmptyBlock/EmptyBlock";
import { InboxEmptinesses, type InboxEmptiness } from "../../types";

export interface EmptyInboxProps {
  /** Filtered by the reviewer, or hidden behind the default status only. */
  reason: Exclude<
    InboxEmptiness,
    typeof InboxEmptinesses.ROWS | typeof InboxEmptinesses.EMPTY
  >;
  /** The Status filter is at its opening pair, so the hidden rows are merged and closed. */
  defaultStatus: boolean;
  onClear: () => void;
  onShowHidden: () => void;
}

/**
 * Where the rows would be when rows exist but none show: filters the
 * reviewer set, with Clear filters; or nothing open at all, with one way to
 * see the merged and closed rows the default keeps out of sight.
 */
export function EmptyInbox({
  reason,
  defaultStatus,
  onClear,
  onShowHidden,
}: EmptyInboxProps) {
  const { t } = useTranslation();
  const hidden = reason === InboxEmptinesses.HIDDEN_BY_DEFAULT;
  const heading = hidden
    ? t("home.empty.hiddenHeading")
    : t("home.empty.filteredHeading");
  const detail = defaultStatus
    ? t("home.empty.filteredDefaultStatus")
    : undefined;
  const action = hidden ? (
    <Button type="button" variant="secondary" onClick={onShowHidden}>
      {t("home.empty.showHidden")}
    </Button>
  ) : (
    <Button type="button" variant="secondary" onClick={onClear}>
      {t("home.empty.clearFilters")}
    </Button>
  );

  return (
    <EmptyBlock action={action} detail={detail} heading={<h3>{heading}</h3>} />
  );
}
