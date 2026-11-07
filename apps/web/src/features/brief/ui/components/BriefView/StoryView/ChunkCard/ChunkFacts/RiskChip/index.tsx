import type { RiskKey } from "../../../../../../../model/types";
import type { AttributeDisplayMeta } from "../../../../../../../model/utils/repo-config";
import { isDisclosedRisk } from "../../../../FocusPanel/utils";
import { RiskBadge } from "../../../../RiskBadge";
import { RiskChipDisclosure } from "../../../../RiskChipDisclosure";
import { RiskDetailList } from "../../../../RiskDetailList";

export interface RiskChipProps {
  risk: RiskKey;
  meta: AttributeDisplayMeta | undefined;
}

/** Repo-defined and de-emphasized chips carry a visible expansion reachable by keyboard and touch. */
export function RiskChip({ risk, meta }: RiskChipProps) {
  if (isDisclosedRisk(meta)) {
    return (
      <RiskChipDisclosure
        detail={<RiskDetailList attrs={[risk]} metaFor={() => meta} />}
      >
        <RiskBadge attribute={risk} meta={meta} />
      </RiskChipDisclosure>
    );
  }
  return <RiskBadge attribute={risk} meta={meta} />;
}
