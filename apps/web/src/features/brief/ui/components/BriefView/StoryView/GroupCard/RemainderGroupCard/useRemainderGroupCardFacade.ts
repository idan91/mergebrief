import { useFlagSurface } from "../../../../../hooks/useFlagSurface";
import type {
  BriefViewModel,
  RiskFlag,
  UnattributedRemainderGroupView,
} from "../../../../../../model/utils/view-model";

const EMPTY_RISK_FLAGS: RiskFlag[] = [];

export interface RemainderGroupCardFacadeParams {
  group: UnattributedRemainderGroupView;
  model: BriefViewModel;
}

/** The remainder's flags on the same surface and store slice an attributed card reads. */
export function useRemainderGroupCardFacade({
  group,
  model,
}: RemainderGroupCardFacadeParams) {
  const groupFlags = model.flagsByGroup.get(group.id) ?? EMPTY_RISK_FLAGS;
  const flagSurface = useFlagSurface(groupFlags);

  return {
    groupFlags,
    hasFlags: groupFlags.length > 0,
    dispositions: flagSurface.dispositions,
    flagsReadOnly: flagSurface.flagsReadOnly,
    selectedFlagSet: flagSurface.selectedFlagSet,
    reopenFlag: flagSurface.reopenFlag,
    setDismissTarget: flagSurface.setDismissTarget,
    setEvidenceTarget: flagSurface.setEvidenceTarget,
    toggleRiskGroup: flagSurface.toggleRiskGroup,
  };
}
