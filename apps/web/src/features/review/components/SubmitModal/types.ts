import type { UnresolvedItem } from "../../utils/state";
import type { UnresolvedItemKind } from "../../utils/types";

/** Everything the Submit control needs, including why it is off. */
export interface SubmitAffordance {
  disabled: boolean;
  pending: boolean;
  describedBy: string | undefined;
  attempt: () => void;
}

/** The three mutually-ranked status lines above the actions row. */
export interface SubmitStatus {
  blockedReason: string | undefined;
  error: string | null;
  note: string | null;
}

/** The modal's in-flow position: verdict is the default, receipt a preview
 * one step away, advisory a conditional first stop with no way back to it. */
export type SubmitView = "advisory" | "verdict" | "receipt";

/** The catalog copy the Submit gate ranks into its reasons. */
export interface SubmitGateCopy {
  uploadPending: string;
  receiptUploadPending: string;
  staleWarning: string;
  receiptStaleWarning: string;
}

/** What decides whether Submit may run, read once per render. */
export interface SubmitGateInputs {
  reviewComment: string;
  blockedReasonOverride: string | undefined;
  blockedReasonWith:
    | ((reviewComment: string) => string | undefined)
    | undefined;
  staleUnacked: boolean;
  submitPending: boolean;
  submitError: string | null;
  submitNote: string | null;
  copy: SubmitGateCopy;
}

/** Whether Submit runs, and the reason each view shows and announces when not. */
export interface SubmitGate {
  disabled: boolean;
  describedBy: string | undefined;
  verdictStatus: SubmitStatus;
  receiptStatus: SubmitStatus;
  receiptStaleWarning: string | undefined;
  verdictRefusal: string | undefined;
  receiptRefusal: string | undefined;
}

/** The advisory list's items of one kind, in the order they were derived. */
export interface UnresolvedItemGroup {
  kind: UnresolvedItemKind;
  items: UnresolvedItem[];
}

export interface AdvisoryRow {
  item: UnresolvedItem;
  kindLabel: string;
}

export interface AdvisoryGroup {
  kind: UnresolvedItemKind;
  heading: string;
  count: number;
  rows: AdvisoryRow[];
}
