import type { ReactNode } from "react";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { AttributeDisplayMeta } from "../../../utils/repoConfig";
import { Badge, BadgeColors } from "@web/components/Badge/Badge";
import styles from "./RiskBadge.module.scss";

export interface RiskBadgeProps {
  children: ReactNode;
  /**
   * Attribute display meta (BRIEF-52): repo-policy chips get the outlined
   * source variant with "defined by repo policy" + the implication in the
   * expansion; de-emphasized chips render quiet. Absent = the plain built-in
   * chip, identical to pre-BRIEF-52 output.
   */
  meta?: AttributeDisplayMeta | undefined;
}

/**
 * @description Risk-surface token chip. Amber like the rail's risk groups,
 * lowercase because the tokens are taxonomy identifiers (the Badge default
 * uppercases role tags); the border recedes so the token carries the weight.
 * Children rather than a token prop so the "+N" overflow chip (token count +
 * screen-reader list) can share the exact skin. One chip anatomy for every
 * source (ADR 0032 #11): repo-defined attributes are a VARIANT of this chip
 * (data-source), never a second chip kind.
 */
export function RiskBadge({ children, meta }: RiskBadgeProps) {
  const repoDefined = meta?.source === "repo-policy";
  const title = repoDefined
    ? `Defined by repo policy${meta?.implication ? ` — ${meta.implication}` : ""}`
    : undefined;
  return (
    <Badge
      className={styles["risk"]}
      // De-emphasis is a HUE shift (amber → neutral), never opacity — small
      // text under reduced opacity falls below 4.5:1 (codex r5 / WCAG 1.4.3).
      color={meta?.deEmphasized ? BadgeColors.NEUTRAL : BadgeColors.AMBER}
      dataset={{
        source: meta?.source,
        deemphasized: meta?.deEmphasized ? "" : undefined,
      }}
      title={title}
    >
      {children}
      {repoDefined ? (
        <ScreenReaderOnly>
          {` — defined by repo policy${meta?.implication ? `. ${meta.implication}` : ""}`}
        </ScreenReaderOnly>
      ) : null}
      {meta?.deEmphasized ? (
        <ScreenReaderOnly> — de-emphasized by repo policy</ScreenReaderOnly>
      ) : null}
    </Badge>
  );
}
