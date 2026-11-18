import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { Kbd, KbdSizes } from "@web/components/Kbd";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { FOCUS_SHORTCUTS, REVEAL_DELAY_MS } from "./consts";
import styles from "./FocusShortcuts.module.scss";

export function FocusShortcuts() {
  const { t } = useTranslation();
  const shiftName = `${t("brief.focusShortcuts.shift")} `;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const cornerRef = useRef<HTMLDivElement>(null);
  const revealTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(revealTimer.current), []);

  // Touch never sends the pointerleave that shuts a hover reveal.
  useEffect(() => {
    if (!open) {
      return;
    }
    const closeFromOutside = (event: PointerEvent) => {
      const inside =
        event.target instanceof Node &&
        cornerRef.current?.contains(event.target) === true;
      if (!inside) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open]);

  const holdsFocus = () =>
    cornerRef.current?.contains(document.activeElement) === true;

  const armReveal = () => {
    window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(
      () => setOpen(true),
      REVEAL_DELAY_MS,
    );
  };

  const disarmReveal = () => {
    window.clearTimeout(revealTimer.current);
    if (!holdsFocus()) {
      setOpen(false);
    }
  };

  // A keyboard activation reports detail 0; a pointer click lands inside the
  // hover reveal and must not shut the list it just opened.
  const toggleFromTrigger = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      setOpen((current) => !current);
      return;
    }
    setOpen(true);
  };

  return (
    <div
      aria-label={t("brief.focusShortcuts.ariaLabel")}
      className={styles["corner"]}
      data-state={open ? "open" : "closed"}
      data-testid="focus-shortcuts"
      ref={cornerRef}
      role="group"
      onPointerEnter={armReveal}
      onPointerLeave={disarmReveal}
    >
      <IconButton
        aria-controls={listId}
        aria-expanded={open}
        autoWidth
        className={styles["trigger"]}
        label={t("brief.focusShortcuts.trigger")}
        onBlur={() => setOpen(false)}
        onClick={toggleFromTrigger}
        onFocus={() => setOpen(true)}
      >
        <Icon name={IconNames.KEYBOARD} size={IconSizes.MD} />
        <span>{t("brief.focusShortcuts.trigger")}</span>
      </IconButton>
      <ul className={styles["keys"]} id={listId}>
        {FOCUS_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.id}>
            {shortcut.keys.map((shortcutKey) => (
              <Kbd key={shortcutKey.key} size={KbdSizes.SM}>
                {shortcutKey.shift ? (
                  <>
                    <span aria-hidden="true">⇧</span>
                    <ScreenReaderOnly>{shiftName}</ScreenReaderOnly>
                  </>
                ) : null}
                {shortcutKey.key}
              </Kbd>
            ))}
            <span>{t(shortcut.descriptionKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
