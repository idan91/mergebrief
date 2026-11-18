import clsx from "clsx";

import MergeBriefMark from "../icons/mergebrief-mark.svg?react";
import { MARK_LOADER_BANDS } from "./consts";
import styles from "./MarkLoader.module.scss";
import {
  MarkLoaderSizes,
  type MarkLoaderSize,
  type MarkLoaderTone,
} from "./types";

export interface MarkLoaderProps {
  tone: MarkLoaderTone;
  size?: MarkLoaderSize;
  className?: string | undefined;
  testId?: string | undefined;
}

/**
 * The mark read in four diagonal bands that light in reading order.
 * Decorative: the status text beside it carries the announcement.
 */
export function MarkLoader({
  tone,
  size = MarkLoaderSizes.SM,
  className,
  testId,
}: MarkLoaderProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx(styles["loader"], className)}
      data-size={size}
      data-testid={testId}
      data-tone={tone}
    >
      {MARK_LOADER_BANDS.map((band) => (
        <MergeBriefMark
          className={styles["band"]}
          data-band={band}
          focusable="false"
          key={band}
        />
      ))}
    </span>
  );
}
