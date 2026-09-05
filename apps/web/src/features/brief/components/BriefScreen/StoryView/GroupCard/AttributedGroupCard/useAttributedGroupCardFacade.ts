import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import type { ReviewComment } from "@web/features/review/utils/comments";
import type { Disposition } from "@web/features/review/session";
import type { ReviewFlowActions } from "@web/features/review/session/flow/store";
import {
  useReviewSession,
  useReviewSessionActions,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import type { Category } from "../../../../../types";
import type {
  AttributedGroupView,
  BriefViewModel,
  RiskFlag,
} from "../../../../../utils/viewModel";
import { selectGroupReviewComments } from "../utils";

const EMPTY_RISK_FLAGS: RiskFlag[] = [];

export interface AttributedGroupCardFacadeParams {
  group: AttributedGroupView;
  model: BriefViewModel;
}

export interface AttributedGroupCardFacadeReturn {
  groupFlags: RiskFlag[];
  dominant: string;
  isReclassified: boolean;
  dispositions: Record<string, Disposition | undefined>;
  reviewComments: ReviewComment[];
  flagsReadOnly: boolean;
  selectedFlagSet: Set<string>;
  reopenFlag: (flag: RiskFlag) => void;
  chooseDominant: (category: Category) => void;
  setDismissTarget: ReviewFlowActions["setDismissTarget"];
  setEvidenceTarget: ReviewFlowActions["setEvidenceTarget"];
  toggleRiskFlag: ReviewFlowActions["toggleRiskFlag"];
  toggleRiskGroup: ReviewFlowActions["toggleRiskGroup"];
}

/**
 * Group-scoped store slices and the card's risk/dominant actions. Whole-map
 * subscriptions would re-render every card (in both kept-warm scope panes)
 * on any disposition/comment write anywhere in the brief.
 */
export function useAttributedGroupCardFacade({
  group,
  model,
}: AttributedGroupCardFacadeParams): AttributedGroupCardFacadeReturn {
  const { t } = useTranslation();
  const groupFlags = model.flagsByGroup.get(group.id) ?? EMPTY_RISK_FLAGS;
  const dominant = useReviewSession(
    (state) => state.dominants[group.id] ?? group.group.dominantCategory,
  );
  const isReclassified = useReviewSession((state) =>
    state.reclassifiedGroups.has(group.id),
  );
  const groupDispositions = useReviewSession(
    useShallow((state) =>
      groupFlags.map((flag) => state.dispositions[flag.id]),
    ),
  );
  const dispositions = useMemo(() => {
    const byId: Record<string, Disposition | undefined> = {};
    groupFlags.forEach((flag, index) => {
      byId[flag.id] = groupDispositions[index];
    });
    return byId;
  }, [groupDispositions, groupFlags]);
  const groupChunkIds = useMemo(
    () => new Set(group.chunks.map((chunk) => chunk.id)),
    [group.chunks],
  );
  const reviewComments = useReviewSession(
    useShallow((state) =>
      selectGroupReviewComments(state, groupFlags, groupChunkIds),
    ),
  );
  const actions = useReviewSessionActions();
  const {
    announce,
    setDismissTarget,
    setEvidenceTarget,
    toggleRiskFlag,
    toggleRiskGroup,
  } = useReviewActions();
  const flagsReadOnly = useReviewFlow((state) => state.flagsReadOnly);

  const groupFlagIds = useMemo(
    () => groupFlags.map((flag) => flag.id),
    [groupFlags],
  );
  const selectedRiskFlags = useReviewFlow(
    useShallow((state) =>
      groupFlagIds.filter((id) => state.selectedRiskFlags.has(id)),
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

  function chooseDominant(category: Category) {
    actions.reclassifyGroup(group.id, category);
    announce(t("brief.story.dominantAnnounce", { category }));
  }

  return {
    groupFlags,
    dominant,
    isReclassified,
    dispositions,
    reviewComments,
    flagsReadOnly,
    selectedFlagSet,
    reopenFlag,
    chooseDominant,
    setDismissTarget,
    setEvidenceTarget,
    toggleRiskFlag,
    toggleRiskGroup,
  };
}
