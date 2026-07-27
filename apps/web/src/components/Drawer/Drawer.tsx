import type { ReactNode } from "react";
import styles from "./Drawer.module.scss";

export interface DrawerProps {
  open: boolean;
  /**
   * @description Accessible name for the drawer's complementary landmark —
   * multiple drawers exist per page, and unnamed duplicate landmarks are
   * indistinguishable in a screen reader's landmark list.
   */
  label: string;
  /**
   * @description Accessible label for the scrim close button.
   */
  closeLabel: string;
  close: () => void;
  asideClassName: string | undefined;
  children: ReactNode;
}

/** Generic drawer shell: a scrim button + a sliding aside with data-state. */
export function Drawer({
  open,
  label,
  closeLabel,
  close,
  asideClassName,
  children,
}: DrawerProps) {
  return (
    <>
      <button
        aria-label={closeLabel}
        className={styles["scrim"]}
        data-state={open ? "open" : "closed"}
        // Closed scrim is off-screen but stays in the DOM; keep it out of the
        // tab order and the a11y tree until the drawer opens.
        inert={!open}
        type="button"
        onClick={close}
      />
      <aside
        aria-label={label}
        className={asideClassName}
        data-state={open ? "open" : "closed"}
        // Same for the panel's own controls — no tabbing into a hidden drawer.
        inert={!open}
      >
        {children}
      </aside>
    </>
  );
}
