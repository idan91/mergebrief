import type { ReactNode } from "react";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import styles from "../../SubmitModal.module.scss";

export interface SubmitReasonProps {
  id: string;
  shown: boolean;
  children: ReactNode;
}

export function SubmitReason({ id, shown, children }: SubmitReasonProps) {
  if (!shown) {
    return <ScreenReaderOnly id={id}>{children}</ScreenReaderOnly>;
  }
  return (
    <p className={styles["submitStatus"]} id={id}>
      {children}
    </p>
  );
}
