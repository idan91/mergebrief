// The flag-disposition modal pair (BRIEF-44 split, plan decision 11): the
// dismiss-with-reason modal and the address-with-evidence modal, lifted out of
// the screen's render tree. Wiring only — the disposition state lives in the
// screen's `useRiskFlagFlow` facade hook, which passes its fields in as props
// (sibling folders never reach into each other's implementation, ADR 0037 #2).
import type { ReviewComment } from "@web/features/review/comments";
import {
  DismissModal,
  type DismissTarget,
} from "@web/features/review/components/DismissModal/DismissModal";
import {
  EvidenceModal,
  type EvidenceTarget,
} from "@web/features/review/components/EvidenceModal/EvidenceModal";
import type { RiskEvidenceKind } from "@web/features/review/state";

export interface RiskFlagModalsProps {
  /** Draft/submitted review comments — the evidence modal's link candidates. */
  comments: ReviewComment[];
  cancelDismiss: () => void;
  cancelEvidence: () => void;
  confirmDismiss: () => void;
  confirmEvidence: (
    kind: RiskEvidenceKind,
    commentId: string | undefined,
    note: string | undefined,
  ) => void;
  dismissReason: string;
  /** Short-reason warn-then-accept: the second confirm goes through. */
  dismissWarned: boolean;
  dismissTarget: DismissTarget | null;
  evidenceTarget: EvidenceTarget | null;
  setDismissReason: (reason: string) => void;
}

export function RiskFlagModals({
  comments,
  cancelDismiss,
  cancelEvidence,
  confirmDismiss,
  confirmEvidence,
  dismissReason,
  dismissWarned,
  dismissTarget,
  evidenceTarget,
  setDismissReason,
}: RiskFlagModalsProps) {
  return (
    <>
      <DismissModal
        target={dismissTarget}
        reason={dismissReason}
        warned={dismissWarned}
        cancel={cancelDismiss}
        confirm={confirmDismiss}
        setReason={setDismissReason}
      />
      <EvidenceModal
        comments={comments}
        target={evidenceTarget}
        cancel={cancelEvidence}
        confirm={confirmEvidence}
      />
    </>
  );
}
