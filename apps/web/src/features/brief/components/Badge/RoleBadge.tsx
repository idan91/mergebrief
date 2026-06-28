import { Roles, type Role } from "../../types";
import { Badge, BadgeColors } from "./Badge";

export interface RoleBadgeProps {
  role: Role;
}

/**
 * @description Chunk-role tag. Carrier reads loud (bright neutral, filled),
 * supporting reads quiet (muted outline) — weight, not hue, so it doesn't
 * collide with the concern-dot palette.
 */
export function RoleBadge({ role }: RoleBadgeProps) {
  return role === Roles.Carrier ? (
    <Badge color={BadgeColors.TEXT} fill>
      carrier
    </Badge>
  ) : (
    <Badge color={BadgeColors.NEUTRAL}>supporting</Badge>
  );
}
