export type ViewMode = "story" | "concerns";
export type LayoutMode = "stacked" | "split";

export interface ToolbarProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export function Toolbar({ viewMode, setViewMode }: ToolbarProps) {
  return (
    <div className="toolbar reveal">
      <div className="viewbar">
        <button
          className={viewMode === "story" ? "active" : ""}
          type="button"
          onClick={() => setViewMode("story")}
        >
          Story
        </button>
        <button
          className={viewMode === "concerns" ? "active" : ""}
          type="button"
          onClick={() => setViewMode("concerns")}
        >
          Concerns
        </button>
      </div>
    </div>
  );
}
