import styles from "./WarmingChip.module.scss";

/** Shown next to a rendered brief while delta/comparison warmup still runs. */
export function WarmingChip() {
  return (
    <span className={styles["warmingChip"]} role="status">
      comparisons warming…
    </span>
  );
}
