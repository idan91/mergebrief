// The flag-disposition facade: dismiss-with-reason, where a short reason warns
// once then accepts, and address-with-evidence; both commit through the session
// store and sweep the flow store's selection. The TARGETS live in the ReviewFlow
// store; only the dismiss modal's input state is local here.
import { useCallback, useState } from "react";

import type { DismissTarget } from "@web/features/review";
import type { EvidenceTarget } from "@web/features/review";
import {
  useReviewSessionActions,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import type {
  RiskEvidence,
  RiskEvidenceKind,
} from "@web/features/review/utils";
import type { RiskFlag } from "../../../../model/utils/viewModel";
import { resolveRiskEvidence } from "../utils";
import { useTranslation } from "react-i18next";

export interface UseRiskFlagModalsFacadeInput {
  /** The view model's flag lookup (evidence resolution). */
  flagsById: Map<string, RiskFlag>;
}

export interface UseRiskFlagModalsFacadeValue {
  dismissTarget: DismissTarget | null;
  dismissReason: string;
  dismissWarned: boolean;
  setDismissReason: (reason: string) => void;
  cancelDismiss: () => void;
  confirmDismiss: () => void;
  evidenceTarget: EvidenceTarget | null;
  cancelEvidence: () => void;
  confirmEvidence: (
    kind: RiskEvidenceKind,
    commentId: string | undefined,
    note: string | undefined,
  ) => void;
}

interface DismissInputState {
  /** The target this input belongs to, a new target resets the input. */
  target: DismissTarget | null;
  reason: string;
  warned: boolean;
}

export function useRiskFlagModalsFacade(
  input: UseRiskFlagModalsFacadeInput,
): UseRiskFlagModalsFacadeValue {
  const { t } = useTranslation();
  const { flagsById } = input;
  const sessionActions = useReviewSessionActions();
  const flowActions = useReviewActions();
  const dismissTarget = useReviewFlow((state) => state.dismissTarget);
  const evidenceTarget = useReviewFlow((state) => state.evidenceTarget);

  const [dismissInput, setDismissInput] = useState<DismissInputState>({
    target: dismissTarget,
    reason: "",
    warned: false,
  });
  // Reset-during-render on target change: reopening always starts blank,
  // without an effect tick where the previous reason flashes.
  if (dismissInput.target !== dismissTarget) {
    setDismissInput({ target: dismissTarget, reason: "", warned: false });
  }

  const setDismissReason = useCallback((reason: string) => {
    setDismissInput((current) => ({ ...current, reason }));
  }, []);
  const cancelDismiss = useCallback(() => {
    flowActions.setDismissTarget(null);
  }, [flowActions]);
  const cancelEvidence = useCallback(() => {
    flowActions.setEvidenceTarget(null);
  }, [flowActions]);

  const confirmDismiss = useCallback(() => {
    if (!dismissTarget) {
      return;
    }
    const reason = dismissInput.reason.trim();
    if (reason.length < 12 && !dismissInput.warned) {
      setDismissInput((current) => ({ ...current, warned: true }));
      return;
    }
    sessionActions.disposeFlag(dismissTarget.flagIds, {
      kind: "dismissed",
      reason: reason || t("review.dismiss.noReasonGiven"),
    });
    flowActions.clearRiskSelection(dismissTarget.flagIds);
    flowActions.setDismissTarget(null);
    const dismissedCount = dismissTarget.flagIds.length;
    flowActions.announce(
      t("review.announce.flagsDismissed", { count: dismissedCount }),
    );
  }, [dismissInput, dismissTarget, flowActions, sessionActions, t]);

  const confirmEvidence = useCallback(
    (
      kind: RiskEvidenceKind,
      commentId: string | undefined,
      note: string | undefined,
    ) => {
      if (!evidenceTarget) {
        return;
      }
      const evidenceByFlagId = new Map<string, RiskEvidence>();
      for (const flagId of evidenceTarget.flagIds) {
        const flag = flagsById.get(flagId);
        if (flag) {
          evidenceByFlagId.set(
            flag.id,
            resolveRiskEvidence(kind, commentId, note, flag.chunkId),
          );
        }
      }
      flowActions.setEvidenceTarget(null);
      if (evidenceByFlagId.size === 0) {
        return;
      }
      sessionActions.addressFlags(evidenceByFlagId);
      const addressedIds = [...evidenceByFlagId.keys()];
      flowActions.clearRiskSelection(addressedIds);
      flowActions.announce(
        t("review.announce.risksAddressed", { count: addressedIds.length }),
      );
    },
    [evidenceTarget, flagsById, flowActions, sessionActions, t],
  );

  return {
    dismissTarget,
    dismissReason: dismissInput.reason,
    dismissWarned: dismissInput.warned,
    setDismissReason,
    cancelDismiss,
    confirmDismiss,
    evidenceTarget,
    cancelEvidence,
    confirmEvidence,
  };
}
