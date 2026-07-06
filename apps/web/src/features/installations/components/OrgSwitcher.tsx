// Org switcher dropdown (BRIEF-19 PR 2.2): current installation as the
// trigger, a menu of accessible installations (menuitemradio — switching is
// choosing one of a set), and a remember-as-default checkbox applied to the
// next switch. WAI-ARIA menu-button pattern: arrows/Home/End roam, Escape and
// outside-click close, focus returns to the trigger.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  installationsQueryOptions,
  reloadToPicker,
  switchInstallation,
} from "../queries";
import styles from "./OrgSwitcher.module.scss";

export interface OrgSwitcherProps {
  /** Only fetch/render once the viewer is known to be signed in. */
  enabled: boolean;
}

export function OrgSwitcher({ enabled }: OrgSwitcherProps) {
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
      // A tenant switch invalidates every piece of client state — queries AND
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
    const last = menuItemCount - 1;
    const next =
      key === "ArrowDown"
        ? (from + 1) % menuItemCount
        : key === "ArrowUp"
          ? (from - 1 + menuItemCount) % menuItemCount
          : key === "Home"
            ? 0
            : last;
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
      <button
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
        type="button"
      >
        <span className={styles["triggerLabel"]}>Organization</span>
        {current?.accountLogin ?? "unknown"}
        <span aria-hidden="true" className={styles["caret"]}>
          ▾
        </span>
      </button>
      {open ? (
        <div
          aria-label="Switch organization"
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
            <button
              aria-checked={item.isCurrent}
              className={styles["item"]}
              disabled={switching.isPending}
              key={item.installationId}
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
              role="menuitemradio"
              type="button"
            >
              <span className={styles["itemLogin"]}>{item.accountLogin}</span>
              <span className={styles["itemMeta"]}>
                {item.isCurrent ? "current" : ""}
                {item.isCurrent && item.isDefault ? " · " : ""}
                {item.isDefault ? "default" : ""}
              </span>
            </button>
          ))}
          {/* Menu-native checkbox item (never a form control inside role=menu)
              — part of the same roving-focus set as the org items. */}
          <button
            aria-checked={setDefault}
            className={styles["defaultToggle"]}
            onClick={() => setSetDefault((value) => !value)}
            onKeyDown={roamKeyDown(items.length)}
            ref={(el) => {
              itemRefs.current[items.length] = el;
            }}
            role="menuitemcheckbox"
            type="button"
          >
            <span
              aria-hidden="true"
              className={styles["checkmark"]}
              data-checked={setDefault}
            >
              {setDefault ? "✓" : ""}
            </span>
            Remember my choice as default
          </button>
          {switching.isError ? (
            <p className={styles["error"]} role="alert">
              Switching failed — the organization may no longer be accessible.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
