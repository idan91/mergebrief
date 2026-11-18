import { type Role, Roles } from "brief-core/types";
import { BadgeColors, type BadgeColor } from "@web/components/Badge";

/**
 * Core reads loud (Text 1), supporting reads quiet (Text 2): lightness, not
 * hue, so it doesn't collide with the concern-dot palette.
 */
export const RoleBadgeColors: Record<Role, BadgeColor> = {
  [Roles.CORE]: BadgeColors.TEXT,
  [Roles.SUPPORTING]: BadgeColors.NEUTRAL,
};
