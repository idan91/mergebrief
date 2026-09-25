import type { ReactNode } from "react";

import { Button } from "../Button";
import styles from "./FailureBlock.module.scss";

export interface FailureBlockProps {
  /** The heading element at the level the screen's structure gives it. */
  heading: ReactNode;
  detail: string;
  retryLabel: string;
  /** The retry is in flight: the button holds and says so. */
  pending?: boolean;
  onRetry: () => void;
}

/** A read that failed: what did not answer, and the one way to ask again. */
export function FailureBlock({
  heading,
  detail,
  retryLabel,
  pending = false,
  onRetry,
}: FailureBlockProps) {
  return (
    <div className={styles["block"]} data-testid="failure-block" role="alert">
      {heading}
      <p className={styles["detail"]}>{detail}</p>
      <Button
        loading={pending}
        type="button"
        variant="secondary"
        onClick={onRetry}
      >
        {retryLabel}
      </Button>
    </div>
  );
}
