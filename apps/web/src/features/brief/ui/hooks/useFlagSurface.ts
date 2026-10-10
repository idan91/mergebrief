import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import {
  type Disposition,
  useReviewActions,
  useReviewFlow,
  useReviewSession,
  useReviewSessionActions,
} from "@web/features/review/session";
import type { RiskFlag } from "../../model/utils/view-model";
import { useReviewPosture } from "./useReviewPosture";

/**
 * The store slices one flag surface reads and the actions it fires, scoped
 * to its flags. Whole-map subscriptions would re-render every surface (in
 * both kept-warm scope panes) on any disposition write anywhere in the
 * brief. A group card and a Changes section share this, so a decision made
 * on either shows on both.
 */
export function useFlagSurface(flags: RiskFlag[]) {
  const { t } = useTranslation();
  const flagDispositions = useReviewSession(
    useShallow((state) => flags.map((flag) => state.dispositions[flag.id])),
  );
  const dispositions = useMemo(() => {
    const byId: Record<string, Disposition | undefined> = {};
    flags.forEach((flag, index) => {
      byId[flag.id] = flagDispositions[index];
    });
    return byId;
  }, [flagDispositions, flags]);
  const actions = useReviewSessionActions();
  const { announce, setDismissTarget, setEvidenceTarget, toggleRiskGroup } =
    useReviewActions();
  const { flagsReadOnly } = useReviewPosture();

  const flagIds = useMemo(() => flags.map((flag) => flag.id), [flags]);
  const selectedRiskFlags = useReviewFlow(
    useShallow((state) =>
      flagIds.filter((id) => state.selectedRiskFlags.has(id)),
    ),
  );
  const selectedFlagSet = useMemo(
    () => new Set(selectedRiskFlags),
    [selectedRiskFlags],
  );

  function reopenFlag(flag: RiskFlag) {
    actions.disposeFlag([flag.id], { kind: "open" });
    announce(t("brief.group.reopenAnnounce"));
  }

  return {
    dispositions,
    flagsReadOnly,
    selectedFlagSet,
    reopenFlag,
    setDismissTarget,
    setEvidenceTarget,
    toggleRiskGroup,
  };
}
