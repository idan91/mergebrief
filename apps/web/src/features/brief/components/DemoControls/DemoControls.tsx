import type { ReviewMode } from "../../../review/state";

export interface DemoControlsProps {
  reviewMode: ReviewMode;
  setReviewMode: (mode: ReviewMode) => void;
}

export function DemoControls({ reviewMode, setReviewMode }: DemoControlsProps) {
  return (
    <div className="demo-controls reveal">
      <div className="viewbar">
        <button
          className={reviewMode === "reviewer" ? "active" : ""}
          type="button"
          onClick={() => setReviewMode("reviewer")}
        >
          Reviewer review
        </button>
        <button
          className={reviewMode === "author" ? "active" : ""}
          type="button"
          onClick={() => setReviewMode("author")}
        >
          Author self-review
        </button>
      </div>
    </div>
  );
}
