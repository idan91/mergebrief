import type { ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  /** Extra class on the inner box (e.g. "evidence-box", "unresolved-box"). */
  boxClassName?: string;
  children: ReactNode;
}

/** Generic centered modal shell; feature modals supply only their content. */
export function Modal({ open, boxClassName, children }: ModalProps) {
  return (
    <div className={open ? "modal show" : "modal"}>
      <div className={boxClassName ? `modal-box ${boxClassName}` : "modal-box"}>
        {children}
      </div>
    </div>
  );
}
