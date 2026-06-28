import type { ReviewMode } from "../../../review/state";
import styles from "./DemoControls.module.scss";

export interface DemoControlsProps {
  reviewMode: ReviewMode;
  setReviewMode: (mode: ReviewMode) => void;
}

export function DemoControls({ reviewMode, setReviewMode }: DemoControlsProps) {
  return (
    <div className={`${styles["controls"]} reveal`}>
      <fieldset className={styles["viewbar"]}>
        <legend className="sr-only">Review perspective</legend>
        <label className={styles["option"]}>
          <input
            checked={reviewMode === "reviewer"}
            className={styles["control"]}
            name="review-perspective"
            type="radio"
            value="reviewer"
            onChange={() => setReviewMode("reviewer")}
          />
          <span className={styles["labelText"]}>Reviewer review</span>
        </label>
        <label className={styles["option"]}>
          <input
            checked={reviewMode === "author"}
            className={styles["control"]}
            name="review-perspective"
            type="radio"
            value="author"
            onChange={() => setReviewMode("author")}
          />
          <span className={styles["labelText"]}>Author self-review</span>
        </label>
      </fieldset>
    </div>
  );
}
