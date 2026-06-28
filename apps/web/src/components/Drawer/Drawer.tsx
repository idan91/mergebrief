import type { ReactNode } from "react";
import styles from "./Drawer.module.scss";

export interface DrawerProps {
  open: boolean;
  /** Accessible label for the scrim close button. */
  closeLabel: string;
  close: () => void;
  asideClassName: string | undefined;
  children: ReactNode;
}

/** Generic drawer shell: a scrim button + a sliding aside with data-state. */
export function Drawer({
  open,
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
        type="button"
        onClick={close}
      />
      <aside className={asideClassName} data-state={open ? "open" : "closed"}>
        {children}
      </aside>
    </>
  );
}
