import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { EmptyBlock } from "@web/components/EmptyBlock";
import { SearchMissKinds, type SearchMissReason } from "../../types";

export interface SearchMissProps {
  /** Why the search shows no rows, with the count it names. */
  reason: SearchMissReason;
  /** The search text, named when nothing matches it anywhere. */
  searchText: string;
  /** The archived view is on screen, so the other view is the Inbox. */
  archivedView: boolean;
  /** Keep the search text and reset every other filter of this view. */
  onShowAllMatches: () => void;
  /** Keep the search text and move to the view that holds the matches. */
  onShowOtherView: () => void;
  onClearSearch: () => void;
}

/**
 * Where the rows would be when a search shows none: how many matches the
 * other filters hide, with one way to see them; else how many the other
 * view holds, with the way there; else that nothing matches, with the way
 * out of the search.
 */
export function SearchMiss({
  reason,
  searchText,
  archivedView,
  onShowAllMatches,
  onShowOtherView,
  onClearSearch,
}: SearchMissProps) {
  const { t } = useTranslation();

  if (reason.kind === SearchMissKinds.NOWHERE) {
    return (
      <EmptyBlock
        action={
          <Button type="button" variant="secondary" onClick={onClearSearch}>
            {t("home.search.miss.clearSearch")}
          </Button>
        }
        heading={
          <h3>{t("home.search.miss.nowhereHeading", { text: searchText })}</h3>
        }
      />
    );
  }

  const heading = <h3>{t("home.search.miss.inViewHeading")}</h3>;
  if (reason.kind === SearchMissKinds.HIDDEN_BY_FILTERS) {
    return (
      <EmptyBlock
        action={
          <Button type="button" variant="secondary" onClick={onShowAllMatches}>
            {t("home.search.miss.showAllMatches")}
          </Button>
        }
        detail={t("home.search.miss.hiddenDetail", { count: reason.count })}
        heading={heading}
      />
    );
  }

  const detail = archivedView
    ? t("home.search.miss.inboxDetail", { count: reason.count })
    : t("home.search.miss.archivedDetail", { count: reason.count });
  const actionLabel = archivedView
    ? t("home.search.miss.showInboxMatches")
    : t("home.search.miss.showArchivedMatches");
  return (
    <EmptyBlock
      action={
        <Button type="button" variant="secondary" onClick={onShowOtherView}>
          {actionLabel}
        </Button>
      }
      detail={detail}
      heading={heading}
    />
  );
}
