import type { ReviewMode, UnresolvedItem } from "../../state";

export interface PreSubmitModalProps {
  close: () => void;
  continueToReceipt: () => void;
  jumpToItem: (item: UnresolvedItem) => void;
  mode: ReviewMode;
  open: boolean;
  unresolvedItems: UnresolvedItem[];
}

export function PreSubmitModal({
  close,
  continueToReceipt,
  jumpToItem,
  mode,
  open,
  unresolvedItems,
}: PreSubmitModalProps) {
  const title =
    mode === "author" ? "Before requesting review" : "Before the receipt";
  const primary =
    mode === "author"
      ? "Continue to self-review summary"
      : "Continue to receipt";
  return (
    <div className={open ? "modal show" : "modal"}>
      <div className="modal-box unresolved-box">
        <h3>{title}</h3>
        <p className="modal-copy">
          This is advisory. You can continue, but the summary will show
          unresolved items exactly as they are.
        </p>
        <div className="unresolved-list">
          {unresolvedItems.length === 0 ? (
            <div className="empty">No unresolved review items.</div>
          ) : null}
          {unresolvedItems.map((item) => (
            <button
              className="unresolved-item"
              key={item.id}
              type="button"
              onClick={() => jumpToItem(item)}
            >
              <span>{unresolvedKindLabel(item.kind)}</span>
              <b>{item.label}</b>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={close}>
            Keep reviewing
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={continueToReceipt}
          >
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}

function unresolvedKindLabel(kind: UnresolvedItem["kind"]): string {
  const labels: Record<UnresolvedItem["kind"], string> = {
    "open-risk": "Open risk",
    "missing-evidence": "Addressed without evidence",
    "unreviewed-carrier": "Unreviewed carrier chunk",
    "draft-comment": "Draft comment",
    "thin-dismissal": "Thin dismissal reason",
  };
  return labels[kind];
}
