import type { CSSProperties } from "react";

import type { PlannedLane } from "../types";
import styles from "./SkeletonLane.module.scss";

interface LaneStyle extends CSSProperties {
  "--skeleton-header": number;
}

export interface SkeletonLaneProps {
  lane: PlannedLane;
}

/** A hunk header's band with its expand arrows, or an expand control's own row. */
export function SkeletonLane({ lane }: SkeletonLaneProps) {
  const style: LaneStyle = { "--skeleton-header": lane.header };
  const variant = lane.band ? "hunk" : "expand";

  return (
    <div
      className={styles["lane"]}
      data-arrows={lane.arrows}
      data-variant={variant}
      style={style}
    />
  );
}
