// Org switcher dropdown. WAI-ARIA menu-button pattern: menuitemradio items
// (switching is choosing one of a set), arrows/Home/End roam, Escape and
// outside-click close, focus returns to the trigger.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  installationsQueryOptions,
  reloadToPicker,
  switchInstallation,
} from "../../queries";
import { Button } from "@web/components/Button/Button";
import { nextMenuFocusIndex } from "@web/utils/menuFocus";
import { MenuItem } from "@web/components/MenuItem/MenuItem";
import styles from "./OrgSwitcher.module.scss";

export interface OrgSwitcherProps {
  /** Only fetch/render once the viewer is known to be signed in. */
  enabled: boolean;
}

export function OrgSwitcher({ enabled }: OrgSwitcherProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [setDefault, setSetDefault] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const view = useQuery({ ...installationsQueryOptions(), enabled }).data;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const switching = useMutation({
    mutationFn: switchInstallation,
    onSuccess: () => {
      // A tenant switch invalidates every piece of client state, queries AND
      // the per-brief session stores. A hard navigation is the honest reset.
      reloadToPicker();
    },
  });

  // Outside click / focus-out closes without stealing focus.
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

  // Opening moves focus to the current installation's item.
  useEffect(() => {
    if (!open || view === undefined) return;
    const currentIndex = Math.max(
      0,
      view.installations.findIndex((item) => item.isCurrent),
    );
    itemRefs.current[currentIndex]?.focus();
  }, [open, view]);

  if (!enabled || view === undefined || view.installations.length === 0) {
    return null;
  }

  const current = view.installations.find((item) => item.isCurrent);
  const items = view.installations;

  // Roving focus spans the org items PLUS the default-toggle item (last).
  const menuItemCount = items.length + 1;
  const roam = (from: number, key: string): void => {
    const next = nextMenuFocusIndex(from, key, menuItemCount);
    itemRefs.current[next]?.focus();
  };

  const roamKeyDown = (index: number) => (event: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      roam(index, event.key);
    }
  };

  return (
    <div className={styles["root"]} ref={rootRef}>
      <Button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        className={styles["trigger"]}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        ref={triggerRef}
      >
        <span className={styles["triggerLabel"]}>
          {t("installations.orgSwitcher.label")}
        </span>
        {current?.accountLogin ?? t("installations.orgSwitcher.unknown")}
        <span aria-hidden="true" className={styles["caret"]}>
          ▾
        </span>
      </Button>
      {open ? (
        <div
          aria-label={t("installations.orgSwitcher.menuLabel")}
          className={styles["menu"]}
          id={menuId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            }
          }}
          role="menu"
          tabIndex={-1}
        >
          {items.map((item, index) => (
            <MenuItem
              checked={item.isCurrent}
              className={styles["item"]}
              disabled={switching.isPending}
              key={item.installationId}
              kind="menuitemradio"
              onClick={() => {
                if (item.isCurrent) {
                  close(true);
                  return;
                }
                switching.mutate({
                  installationId: item.installationId,
                  setDefault,
                });
              }}
              onKeyDown={roamKeyDown(index)}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
            >
              <span className={styles["itemLogin"]}>{item.accountLogin}</span>
              <span className={styles["itemMeta"]}>
                {item.isCurrent ? t("installations.orgSwitcher.current") : ""}
                {item.isCurrent && item.isDefault ? " · " : ""}
                {item.isDefault ? t("installations.orgSwitcher.default") : ""}
              </span>
            </MenuItem>
          ))}
          {/* Menu-native checkbox item (never a form control inside role=menu),
             part of the same roving-focus set as the org items. */}
          <MenuItem
            checked={setDefault}
            className={styles["defaultToggle"]}
            kind="menuitemcheckbox"
            onClick={() => setSetDefault((value) => !value)}
            onKeyDown={roamKeyDown(items.length)}
            ref={(el) => {
              itemRefs.current[items.length] = el;
            }}
          >
            <span
              aria-hidden="true"
              className={styles["checkmark"]}
              data-checked={setDefault}
            >
              {setDefault ? "✓" : ""}
            </span>
            {t("installations.orgSwitcher.rememberDefault")}
          </MenuItem>
          {switching.isError ? (
            <p className={styles["error"]} role="alert">
              {t("installations.orgSwitcher.switchFailed")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
