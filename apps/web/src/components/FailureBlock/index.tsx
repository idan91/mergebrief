import type { ReactNode } from "react";

import { Button, ButtonSizes, type ButtonSize } from "../Button";
import styles from "./FailureBlock.module.scss";
import { FailureBlockScales, type FailureBlockScale } from "./types";

export interface FailureBlockProps {
  /** The heading element at the level the screen's structure gives it. */
  heading: ReactNode;
  detail: string;
  retryLabel: string;
  /** The retry is in flight: the button holds and says so. */
  pending?: boolean;
  /** A failure inside a page reads at the size of the content around it. */
  scale?: FailureBlockScale;
  onRetry: () => void;
}

const RETRY_SIZE_BY_SCALE: Record<FailureBlockScale, ButtonSize> = {
  [FailureBlockScales.PAGE]: ButtonSizes.MD,
  [FailureBlockScales.REGION]: ButtonSizes.SM,
};

/** A read that failed: what did not answer, and the one way to ask again. */
export function FailureBlock({
  heading,
  detail,
  retryLabel,
  pending = false,
  scale = FailureBlockScales.PAGE,
  onRetry,
}: FailureBlockProps) {
  return (
    <div
      className={styles["block"]}
      data-scale={scale}
      data-testid="failure-block"
      role="alert"
    >
      {heading}
      <p className={styles["detail"]}>{detail}</p>
      <Button
        loading={pending}
        size={RETRY_SIZE_BY_SCALE[scale]}
        type="button"
        variant="secondary"
        onClick={onRetry}
      >
        {retryLabel}
      </Button>
    </div>
  );
}
