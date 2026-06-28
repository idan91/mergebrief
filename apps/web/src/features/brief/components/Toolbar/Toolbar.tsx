import styles from "./Toolbar.module.scss";

export type ViewMode = "story" | "concerns";
export type LayoutMode = "stacked" | "split";

export interface ToolbarProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export function Toolbar({ viewMode, setViewMode }: ToolbarProps) {
  return (
    <div className={`${styles["toolbar"]} reveal`}>
      <fieldset className={styles["viewbar"]}>
        <legend className="sr-only">Review view</legend>
        <label className={styles["option"]}>
          <input
            checked={viewMode === "story"}
            className={styles["control"]}
            name="review-view"
            type="radio"
            value="story"
            onChange={() => setViewMode("story")}
          />
          <span className={styles["labelText"]}>Story</span>
        </label>
        <label className={styles["option"]}>
          <input
            checked={viewMode === "concerns"}
            className={styles["control"]}
            name="review-view"
            type="radio"
            value="concerns"
            onChange={() => setViewMode("concerns")}
          />
          <span className={styles["labelText"]}>Concerns</span>
        </label>
      </fieldset>
    </div>
  );
}
