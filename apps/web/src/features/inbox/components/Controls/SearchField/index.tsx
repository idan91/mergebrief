import { InboxQueryBounds } from "contract";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { Kbd, KbdSizes } from "@web/components/Kbd";
import { FilterStates, type FilterState } from "../types";
import { SEARCH_FOCUS_KEY } from "./consts";
import styles from "./SearchField.module.scss";
import { useSearchFieldFacade } from "./useSearchFieldFacade";

export interface SearchFieldProps {
  /** The search text the URL holds; empty when the reviewer is not searching. */
  value: string;
  /** Rows the list holds for that text, across every page. */
  resultCount: number;
  /** Times the filters were cleared; a step empties the field even while its search is still loading. */
  clearCount: number;
  onSearch: (text: string) => void;
  /** The reviewer typed past a write whose list is still loading; stop waiting for it. */
  onDropPendingSearch: () => void;
}

/**
 * The search text as one of the filters: the trigger's height, corner and
 * type, the accent once it narrows the list. A slash hint at rest gives way
 * to a clear button; the result count is spoken, never drawn here.
 */
export function SearchField({
  value,
  resultCount,
  clearCount,
  onSearch,
  onDropPendingSearch,
}: SearchFieldProps) {
  const { t } = useTranslation();
  const actions = { onSearch, onDropPendingSearch };
  const facade = useSearchFieldFacade(value, clearCount, actions);
  const searching = value !== "";
  const state: FilterState = searching
    ? FilterStates.CHANGED
    : FilterStates.DEFAULT;
  const announcement = searching
    ? t("home.search.results", { count: resultCount, text: value })
    : null;

  return (
    <search className={styles["field"]} data-state={state}>
      <Icon
        className={styles["icon"]}
        name={IconNames.MAGNIFYING_GLASS}
        size={IconSizes.SM}
      />
      <input
        aria-keyshortcuts={SEARCH_FOCUS_KEY}
        aria-label={t("home.search.ariaLabel")}
        autoComplete="off"
        className={styles["input"]}
        enterKeyHint="search"
        maxLength={InboxQueryBounds.MAX_SEARCH_TEXT_LENGTH}
        placeholder={t("home.search.placeholder")}
        ref={facade.inputRef}
        spellCheck={false}
        type="search"
        value={facade.text}
        onChange={facade.change}
        onKeyDown={facade.pressKey}
      />
      {facade.text === "" ? (
        <span aria-hidden="true" className={styles["hint"]}>
          <Kbd size={KbdSizes.SM}>{SEARCH_FOCUS_KEY}</Kbd>
        </span>
      ) : (
        <IconButton label={t("home.search.clear")} onClick={facade.clear}>
          <Icon name={IconNames.X} size={IconSizes.SM} />
        </IconButton>
      )}
      <span aria-live="polite" className="sr-only" role="status">
        {announcement}
      </span>
    </search>
  );
}
