import { useTranslation } from "react-i18next";

import {
  useReviewActions,
  useReviewSession,
  useReviewSessionActions,
} from "@web/features/review/session";
import type { Category } from "../../../../../types";
import { useFlagSurface } from "../../../../../hooks/useFlagSurface";
import {
  getCategoryLabel,
  type AttributedGroupView,
  type BriefViewModel,
  type RiskFlag,
} from "../../../../../utils/viewModel";

const EMPTY_RISK_FLAGS: RiskFlag[] = [];

export interface AttributedGroupCardFacadeParams {
  group: AttributedGroupView;
  model: BriefViewModel;
}

/**
 * Group-scoped store slices and the card's risk/dominant actions. The flag
 * slice is the one a Changes section reads too, so both surfaces agree.
 */
export function useAttributedGroupCardFacade({
  group,
  model,
}: AttributedGroupCardFacadeParams) {
  const { t } = useTranslation();
  const groupFlags = model.flagsByGroup.get(group.id) ?? EMPTY_RISK_FLAGS;
  const dominant = useReviewSession(
    (state) => state.dominants[group.id] ?? group.group.dominantCategory,
  );
  const isReclassified = useReviewSession((state) =>
    state.reclassifiedGroups.has(group.id),
  );
  const flagSurface = useFlagSurface(groupFlags);
  const actions = useReviewSessionActions();
  const { announce } = useReviewActions();

  function chooseDominant(category: Category) {
    const categoryLabel = getCategoryLabel(t, category);

    actions.reclassifyGroup(group.id, category);
    announce(t("brief.story.dominantAnnounce", { category: categoryLabel }));
  }

  return {
    groupFlags,
    dominant,
    isReclassified,
    dispositions: flagSurface.dispositions,
    flagsReadOnly: flagSurface.flagsReadOnly,
    selectedFlagSet: flagSurface.selectedFlagSet,
    reopenFlag: flagSurface.reopenFlag,
    chooseDominant,
    setDismissTarget: flagSurface.setDismissTarget,
    setEvidenceTarget: flagSurface.setEvidenceTarget,
    toggleRiskGroup: flagSurface.toggleRiskGroup,
  };
}
