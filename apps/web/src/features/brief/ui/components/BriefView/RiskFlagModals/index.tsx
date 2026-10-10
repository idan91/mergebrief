// The flag-disposition modal pair: the dismiss-with-reason modal and the
// address-with-evidence modal. Targets and selection live in the ReviewFlow
// store; the commit/warn choreography lives in the colocated facade hook.
import { DismissModal } from "@web/features/review";
import { EvidenceModal } from "@web/features/review";
import { useReviewSession } from "@web/features/review/session";
import type { RiskFlag } from "../../../../model/utils/viewModel";
import { useRiskFlagModalsFacade } from "./useRiskFlagModalsFacade";

export interface RiskFlagModalsProps {
  /** The view model's flag lookup (evidence resolution). */
  flagsById: Map<string, RiskFlag>;
}

export function RiskFlagModals({ flagsById }: RiskFlagModalsProps) {
  // Draft/submitted review comments, the evidence modal's link candidates.
  const comments = useReviewSession((state) => state.reviewComments);
  const facade = useRiskFlagModalsFacade({ flagsById });
  return (
    <>
      <DismissModal
        target={facade.dismissTarget}
        reason={facade.dismissReason}
        warned={facade.dismissWarned}
        cancel={facade.cancelDismiss}
        confirm={facade.confirmDismiss}
        setReason={facade.setDismissReason}
      />
      <EvidenceModal
        comments={comments}
        target={facade.evidenceTarget}
        cancel={facade.cancelEvidence}
        confirm={facade.confirmEvidence}
      />
    </>
  );
}
