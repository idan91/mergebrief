import { useTranslation } from "react-i18next";
import type { Role } from "brief-core/types";
import { Badge } from "@web/components/Badge";

import { getRoleLabel } from "../../../../../../model/utils/view-model";
import { RoleBadgeColors } from "./consts";

export interface RoleBadgeProps {
  role: Role;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const { t } = useTranslation();
  const label = getRoleLabel(t, role);
  return <Badge color={RoleBadgeColors[role]}>{label}</Badge>;
}
