export interface DismissTarget {
  flagIds: string[];
  label: string;
}

export function DismissModal({
  target,
  reason,
  warned,
  cancel,
  confirm,
  setReason,
}: {
  target: DismissTarget | null;
  reason: string;
  warned: boolean;
  cancel: () => void;
  confirm: () => void;
  setReason: (reason: string) => void;
}) {
  return (
    <div className={target ? "modal show" : "modal"}>
      <div className="modal-box">
        <h3>Dismiss flag</h3>
        <div className="mattr">{target?.label}</div>
        <textarea
          suppressHydrationWarning
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this flag not actionable here? Your reason lands on the receipt, verbatim."
        />
        <div className={warned ? "modal-warn show" : "modal-warn"}>
          Thin reason on a flag — it will appear on the receipt exactly as
          written. Dismiss anyway?
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={cancel}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={confirm}>
            {warned ? "Dismiss anyway" : "Dismiss with reason"}
          </button>
        </div>
      </div>
    </div>
  );
}
