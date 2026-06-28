import type { ReactNode } from "react";

export interface DrawerProps {
  open: boolean;
  /** Accessible label for the scrim close button. */
  closeLabel: string;
  close: () => void;
  /** Base class on the sliding aside (e.g. "receipt", "receipt summary-drawer"). */
  asideClassName: string;
  children: ReactNode;
}

/** Generic right-side drawer: a scrim button + a sliding aside that gets `show`. */
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
        className={open ? "scrim show" : "scrim"}
        type="button"
        onClick={close}
      />
      <aside className={open ? `${asideClassName} show` : asideClassName}>
        {children}
      </aside>
    </>
  );
}
