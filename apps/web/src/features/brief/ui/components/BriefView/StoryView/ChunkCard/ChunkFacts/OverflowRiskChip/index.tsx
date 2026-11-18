import { useTranslation } from "react-i18next";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { RiskKey } from "../../../../../../../model/types";
import type { AttributeDisplayMeta } from "../../../../../../../model/utils/repo-config";
import { getRiskAttributeLabel } from "../../../../../../../model/utils/view-model";
import { RiskBadge } from "../../../../RiskBadge";
import { RiskChipDisclosure } from "../../../../RiskChipDisclosure";
import { RiskDetailList } from "../../../../RiskDetailList";

export interface OverflowRiskChipProps {
  attrs: RiskKey[];
  riskMeta?: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
}

/**
 * The "+N" chip for risk attributes beyond the head's chip budget. The list
 * opens in the portal-rendered Callout, so the card's overflow clip cannot
 * swallow it; screen readers get the list inline via the hidden span.
 */
export function OverflowRiskChip({ attrs, riskMeta }: OverflowRiskChipProps) {
  const { t } = useTranslation();
  const spokenAttributes = attrs
    .map((attr) => getRiskAttributeLabel(t, attr))
    .join(", ");
  return (
    <RiskChipDisclosure
      detail={
        <RiskDetailList attrs={attrs} metaFor={(attr) => riskMeta?.get(attr)} />
      }
    >
      <RiskBadge>
        +{attrs.length}
        <ScreenReaderOnly>{` ${spokenAttributes}`}</ScreenReaderOnly>
      </RiskBadge>
    </RiskChipDisclosure>
  );
}
