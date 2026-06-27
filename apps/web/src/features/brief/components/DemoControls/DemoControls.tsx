import type { ReviewMode } from "../../../review/state";

export function DemoControls({
  reviewMode,
  setReviewMode,
}: {
  reviewMode: ReviewMode;
  setReviewMode: (mode: ReviewMode) => void;
}) {
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
