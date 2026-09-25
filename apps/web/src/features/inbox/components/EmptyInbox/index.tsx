import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { EmptyBlock } from "@web/components/EmptyBlock";
import { InboxEmptinesses, type InboxEmptiness } from "../../types";

export interface EmptyInboxProps {
  /** Why no row shows while rows exist. */
  reason: Exclude<
    InboxEmptiness,
    typeof InboxEmptinesses.ROWS | typeof InboxEmptinesses.EMPTY
  >;
  /** The Status filter is at its opening pair, so the hidden rows are merged and closed. */
  defaultStatus: boolean;
  /** The viewer's archived rows, whatever the filters. */
  archivedTotal: number;
  onClear: () => void;
  onShowHidden: () => void;
  onShowArchived: () => void;
  onShowInbox: () => void;
}

/**
 * Where the rows would be when rows exist but none show: filters the
 * reviewer set, with Clear filters; nothing open at all, with one way to
 * see the merged and closed rows the default keeps out of sight; every row
 * archived, with the way to the archived view; or the archived view with
 * nothing in it, with the way back.
 */
export function EmptyInbox({
  reason,
  defaultStatus,
  archivedTotal,
  onClear,
  onShowHidden,
  onShowArchived,
  onShowInbox,
}: EmptyInboxProps) {
  const { t } = useTranslation();

  if (reason === InboxEmptinesses.ARCHIVED_ONLY) {
    return (
      <EmptyBlock
        action={
          <Button type="button" variant="secondary" onClick={onShowInbox}>
            {t("home.empty.showInbox")}
          </Button>
        }
        heading={<h3>{t("home.empty.archivedHeading")}</h3>}
      />
    );
  }
  if (reason === InboxEmptinesses.ALL_ARCHIVED) {
    return (
      <EmptyBlock
        action={
          <Button type="button" variant="secondary" onClick={onShowArchived}>
            {t("home.empty.showArchived")}
          </Button>
        }
        detail={t("home.empty.allArchivedDetail")}
        heading={
          <h3>
            {t("home.empty.allArchivedHeading", { count: archivedTotal })}
          </h3>
        }
      />
    );
  }

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
