import styles from "./SinceMarker.module.scss";

export interface SinceMarkerProps {
  /** Distinct member files changed since the checkpoint (0 = unchanged). */
  changedFileCount: number;
  /** The checkpoint's short SHA, already truncated for display. */
  baselineShortSha: string;
  /**
   * Opens the delta lens (Compare = Your last review). Route-owned — absent
   * where no navigation is wired (the local demo path); the marker then
   * renders as plain text.
   */
  openDeltaLens?: (() => void) | undefined;
}

/**
 * Per-group changed-since marker (BRIEF-102): surfaces the last-review delta
 * where people actually read — the group header — with Compare off. Router-
 * free by design: BriefView renders without a RouterProvider in tests, so
 * navigation arrives as an injected callback, never a router hook.
 */
export function SinceMarker({
  changedFileCount,
  baselineShortSha,
  openDeltaLens,
}: SinceMarkerProps) {
  if (changedFileCount === 0) {
    return (
      <span
        className={styles["marker"]}
        data-state="unchanged"
        data-testid="group-since-marker"
      >
        unchanged since your last review
      </span>
    );
  }
  const label = `${changedFileCount} file${changedFileCount === 1 ? "" : "s"} changed since ${baselineShortSha}`;
  return (
    <span
      className={styles["marker"]}
      data-state="changed"
      data-testid="group-since-marker"
    >
      {openDeltaLens === undefined ? (
        label
      ) : (
        <button
          className={styles["deltaLink"]}
          title="Open the delta lens — compare against your last review"
          type="button"
          onClick={openDeltaLens}
        >
          {label}
        </button>
      )}
    </span>
  );
}
