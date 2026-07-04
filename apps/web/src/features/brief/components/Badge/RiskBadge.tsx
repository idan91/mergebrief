import type { ReactNode } from "react";

import { Badge, BadgeColors } from "./Badge";
import styles from "./RiskBadge.module.scss";

export interface RiskBadgeProps {
  children: ReactNode;
}

/**
 * @description Risk-surface token chip. Amber like the rail's risk groups,
 * lowercase because the tokens are taxonomy identifiers (the Badge default
 * uppercases role tags); the border recedes so the token carries the weight.
 * Children rather than a token prop so the "+N" overflow chip (token count +
 * screen-reader list) can share the exact skin.
 */
export function RiskBadge({ children }: RiskBadgeProps) {
  return (
    <Badge className={styles["risk"]} color={BadgeColors.AMBER}>
      {children}
    </Badge>
  );
}
