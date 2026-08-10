import { Roles, type Role } from "../../../../../types";
import { Badge, BadgeColors } from "@web/components/Badge/Badge";

export interface RoleBadgeProps {
  role: Role;
}

/**
 * Core reads loud (bright neutral, filled), supporting reads quiet (muted
 * outline) — weight, not hue, so it doesn't collide with the concern-dot
 * palette.
 */
export function RoleBadge({ role }: RoleBadgeProps) {
  return role === Roles.CARRIER ? (
    <Badge color={BadgeColors.TEXT} fill>
      core
    </Badge>
  ) : (
    <Badge color={BadgeColors.NEUTRAL}>supporting</Badge>
  );
}
