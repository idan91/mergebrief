import { SYNTAX_PALETTE, TEXT_CLASS_ID } from "@web/utils/diffTokens/palette";

const SYNTAX_CLASS_PREFIX = "syn-";

/** The stylesheet class for a palette index; an unknown index reads as text. */
export function resolveSyntaxClass(classId: number): string {
  const entry = SYNTAX_PALETTE[classId] ?? SYNTAX_PALETTE[TEXT_CLASS_ID];

  return `${SYNTAX_CLASS_PREFIX}${entry.token}`;
}
