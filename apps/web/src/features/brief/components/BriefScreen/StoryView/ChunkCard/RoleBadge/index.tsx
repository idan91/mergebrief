import { useTranslation } from "react-i18next";
import { Roles, type Role } from "../../../../../types";
import { Badge, BadgeColors } from "@web/components/Badge";

export interface RoleBadgeProps {
  role: Role;
}

/**
 * Core reads loud (Text 1), supporting reads quiet (Text 2): lightness, not
 * hue, so it doesn't collide with the concern-dot palette.
 */
export function RoleBadge({ role }: RoleBadgeProps) {
  const { t } = useTranslation();
  return role === Roles.CORE ? (
    <Badge color={BadgeColors.TEXT}>{t("brief.chunk.roleCore")}</Badge>
  ) : (
    <Badge color={BadgeColors.NEUTRAL}>{t("brief.chunk.roleSupporting")}</Badge>
  );
}
