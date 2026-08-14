// WAI-ARIA menu-button over the catalog's locale registry. Rows are
// `menuitemradio` (one mutually-exclusive choice), roving `tabindex` keeps a
// single tab stop, and Tab leaves the menu instead of walking it.
import { LOCALES, PSEUDO_LOCALE } from "i18n";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button/Button";
import { MenuItem } from "@web/components/MenuItem/MenuItem";
import { changeLocale } from "../I18nProvider";
import styles from "./LocalePicker.module.scss";

interface LocaleOption {
  readonly id: string;
  readonly nativeName: string;
}

/** Registry rows plus the dev-only pseudo entry. */
function localeOptions(): LocaleOption[] {
  const options: LocaleOption[] = LOCALES.map((entry) => ({
    id: entry.id,
    nativeName: entry.nativeName,
  }));
  if (import.meta.env.DEV) {
    options.push({ id: PSEUDO_LOCALE, nativeName: "Pseudo (dev)" });
  }
  return options;
}

export function LocalePicker() {
  const { t, i18n } = useTranslation();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const options = localeOptions();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        close(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close, open]);

  // A region tag (en-GB) falls back to its base row. `-1` means the runtime
  // locale is in NO row — kept distinct from index 0 so the menu never checks
  // a row the viewer is not actually on.
  const matchedIndex = options.findIndex(
    (option) =>
      option.id === i18n.language || option.id === i18n.language.split("-")[0],
  );
  const focusIndex = Math.max(0, matchedIndex);

  // Opening moves focus to the active row (menu-button pattern).
  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus();
  }, [focusIndex, open]);

  const roam = (from: number, key: string): void => {
    const last = options.length - 1;
    const next =
      key === "ArrowDown"
        ? (from + 1) % options.length
        : key === "ArrowUp"
          ? (from - 1 + options.length) % options.length
          : key === "Home"
            ? 0
            : last;
    itemRefs.current[next]?.focus();
  };

  const roamKeyDown = (index: number) => (event: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      roam(index, event.key);
    }
  };

  const activeOption = options[focusIndex];

  return (
    <div className={styles["root"]} ref={rootRef}>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("shell.localePicker.ariaLabelTrigger", {
          locale: activeOption?.nativeName ?? i18n.language,
        })}
        className={styles["trigger"]}
        data-testid="locale-picker-trigger"
        ref={triggerRef}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {/* Decorative: the accessible name carries the language. */}
        <svg
          aria-hidden="true"
          className={styles["globe"]}
          fill="none"
          height="16"
          viewBox="0 0 16 16"
          width="16"
        >
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" />
          <path
            d="M8 1.75c1.9 2 1.9 10.5 0 12.5M8 1.75c-1.9 2-1.9 10.5 0 12.5M2 8h12"
            stroke="currentColor"
          />
        </svg>
        {/* Tagged with its own language so AT pronounces the native name
            correctly, even though the surrounding label is English. */}
        <span
          className={styles["triggerLabel"]}
          lang={
            activeOption?.id === PSEUDO_LOCALE ? undefined : activeOption?.id
          }
        >
          {activeOption?.nativeName}
        </span>
      </Button>
      {open ? (
        <div
          aria-label={t("shell.localePicker.ariaLabelMenu")}
          className={styles["menu"]}
          id={menuId}
          role="menu"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            }
            // Tab leaves the menu rather than walking its rows: roving
            // tabindex keeps exactly one tab stop, so the browser's next stop
            // is whatever follows the trigger.
            if (event.key === "Tab") close(false);
          }}
        >
          {options.map((option, index) => (
            <MenuItem
              checked={index === matchedIndex}
              className={styles["item"]}
              key={option.id}
              lang={option.id === PSEUDO_LOCALE ? undefined : option.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              kind="menuitemradio"
              tabIndex={index === focusIndex ? 0 : -1}
              onClick={() => {
                void changeLocale(option.id);
                close(true);
              }}
              onKeyDown={roamKeyDown(index)}
            >
              <span className={styles["itemName"]}>{option.nativeName}</span>
              <span aria-hidden="true" className={styles["itemCheck"]}>
                {index === matchedIndex ? "✓" : ""}
              </span>
            </MenuItem>
          ))}
        </div>
      ) : null}
    </div>
  );
}
