// The risk-disposition facade hook (BRIEF-44 split, plan decision 11): flag
// selection, the dismiss-with-reason modal (short-reason warn-then-accept),
// and the address-with-evidence modal. The screen wires props in; the hook
// owns the selection/modal state and the disposition toast copy.
import { useCallback, useState } from "react";

import type { DismissTarget } from "@web/features/review/components/DismissModal/DismissModal";
import type { EvidenceTarget } from "@web/features/review/components/EvidenceModal/EvidenceModal";
import type { MindMapActions } from "@web/features/review/session";
import type {
  RiskEvidence,
  RiskEvidenceKind,
} from "@web/features/review/state";
import type { RiskFlag } from "../../viewModel";

export interface UseRiskFlagFlowInput {
  actions: MindMapActions;
  /** The view model's flag lookup (evidence resolution). */
  flagsById: Map<string, RiskFlag>;
  /** The page live-region channel for disposition copy. */
  setToast: (message: string) => void;
}

export interface UseRiskFlagFlowValue {
  selectedRiskFlags: Set<string>;
  toggleRiskFlag: (flagId: string) => void;
  toggleRiskGroup: (flagIds: string[]) => void;
  dismissTarget: DismissTarget | null;
  dismissReason: string;
  dismissWarned: boolean;
  openDismiss: (target: DismissTarget) => void;
  setDismissReason: (reason: string) => void;
  cancelDismiss: () => void;
  confirmDismiss: () => void;
  evidenceTarget: EvidenceTarget | null;
  openEvidence: (target: EvidenceTarget) => void;
  cancelEvidence: () => void;
  confirmEvidence: (
    kind: RiskEvidenceKind,
    commentId: string | undefined,
    note: string | undefined,
  ) => void;
  /** Either disposition modal is up (feeds the shortcut stand-down). */
  modalOpen: boolean;
  /** Own-draft entry reset: both modals close, targets cleared. */
  closeModals: () => void;
}

export function useRiskFlagFlow(
  input: UseRiskFlagFlowInput,
): UseRiskFlagFlowValue {
  const { actions, flagsById, setToast } = input;
  const [selectedRiskFlags, setSelectedRiskFlags] = useState<Set<string>>(
    () => new Set(),
  );
  const [dismissTarget, setDismissTarget] = useState<DismissTarget | null>(
    null,
  );
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(
    null,
  );
  const [dismissReason, setDismissReason] = useState("");
  const [dismissWarned, setDismissWarned] = useState(false);

  const clearSelection = useCallback((flagIds: string[]) => {
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      for (const flagId of flagIds) next.delete(flagId);
      return next;
    });
  }, []);

  const toggleRiskFlag = useCallback((flagId: string) => {
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      if (next.has(flagId)) next.delete(flagId);
      else next.add(flagId);
      return next;
    });
  }, []);

  const toggleRiskGroup = useCallback((flagIds: string[]) => {
    setSelectedRiskFlags((current) => {
      const allSelected =
        flagIds.length > 0 && flagIds.every((flagId) => current.has(flagId));
      const next = new Set(current);
      for (const flagId of flagIds) {
        if (allSelected) next.delete(flagId);
        else next.add(flagId);
      }
      return next;
    });
  }, []);

  const addressWithEvidence = useCallback(
    (flagIds: string[], evidenceForFlag: (flag: RiskFlag) => RiskEvidence) => {
      const evidenceByFlagId = new Map<string, RiskEvidence>();
      for (const flagId of flagIds) {
        const flag = flagsById.get(flagId);
        if (flag) evidenceByFlagId.set(flag.id, evidenceForFlag(flag));
      }
      if (evidenceByFlagId.size === 0) return;
      actions.addressFlags(evidenceByFlagId);
      const addressedIds = [...evidenceByFlagId.keys()];
      clearSelection(addressedIds);
      setToast(
        addressedIds.length === 1
          ? "Risk marked addressed with evidence."
          : `${addressedIds.length} risks marked addressed with evidence.`,
      );
    },
    [actions, clearSelection, flagsById, setToast],
  );

  const confirmDismiss = useCallback(() => {
    if (!dismissTarget) return;
    const reason = dismissReason.trim();
    if (reason.length < 12 && !dismissWarned) {
      setDismissWarned(true);
      return;
    }
    actions.disposeFlag(dismissTarget.flagIds, {
      kind: "dismissed",
      reason: reason || "(no reason given)",
    });
    clearSelection(dismissTarget.flagIds);
    const dismissedCount = dismissTarget.flagIds.length;
    setDismissTarget(null);
    setDismissReason("");
    setDismissWarned(false);
    setToast(
      dismissedCount === 1
        ? "Dismissed. Reason recorded verbatim on the receipt."
        : `${dismissedCount} flags dismissed. Reason recorded verbatim on the receipt.`,
    );
  }, [
    actions,
    clearSelection,
    dismissReason,
    dismissTarget,
    dismissWarned,
    setToast,
  ]);

  const openDismiss = useCallback((target: DismissTarget) => {
    setDismissTarget(target);
    setDismissReason("");
    setDismissWarned(false);
  }, []);
  const cancelDismiss = useCallback(() => setDismissTarget(null), []);
  const cancelEvidence = useCallback(() => setEvidenceTarget(null), []);
  const confirmEvidence = useCallback(
    (
      kind: RiskEvidenceKind,
      commentId: string | undefined,
      note: string | undefined,
    ) => {
      if (!evidenceTarget) return;
      addressWithEvidence(evidenceTarget.flagIds, (flag) => {
        if (kind === "linked-comment")
          return commentId
            ? { kind, commentId }
            : { kind: "chunk-reviewed", chunkId: flag.chunkId };
        if (kind === "chunk-reviewed") return { kind, chunkId: flag.chunkId };
        return note ? { kind, note } : { kind };
      });
      setEvidenceTarget(null);
    },
    [addressWithEvidence, evidenceTarget],
  );
  const closeModals = useCallback(() => {
    setDismissTarget(null);
    setEvidenceTarget(null);
  }, []);

  return {
    selectedRiskFlags,
    toggleRiskFlag,
    toggleRiskGroup,
    dismissTarget,
    dismissReason,
    dismissWarned,
    openDismiss,
    setDismissReason,
    cancelDismiss,
    confirmDismiss,
    evidenceTarget,
    openEvidence: setEvidenceTarget,
    cancelEvidence,
    confirmEvidence,
    modalOpen: dismissTarget !== null || evidenceTarget !== null,
    closeModals,
  };
}
