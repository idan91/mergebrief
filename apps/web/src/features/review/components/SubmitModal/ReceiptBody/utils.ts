import type { ReceiptRiskGroup } from "../../../utils/receipt";
import { DispositionKinds } from "../../../session/types";
import { ReceiptSections, type ReceiptSection } from "./types";

const RECEIPT_SECTION_VALUES: ReadonlySet<string> = new Set(
  Object.values(ReceiptSections),
);

export function isReceiptSection(value: string): value is ReceiptSection {
  return RECEIPT_SECTION_VALUES.has(value);
}

/** Open risks lead when there are any, since they are what a reviewer acts on. */
export function pickFirstSection(
  openRisks: number,
  hasSignature: boolean,
): ReceiptSection {
  if (openRisks > 0 || !hasSignature) {
    return ReceiptSections.RISKS;
  }
  return ReceiptSections.SIGNATURE;
}

/** The risk groups worth a heading: open first, empty ones dropped. */
export function listShownRiskGroups(
  groups: readonly ReceiptRiskGroup[],
): ReceiptRiskGroup[] {
  const shown = groups.filter((group) => group.items.length > 0);
  const open = shown.filter((group) => group.key === DispositionKinds.OPEN);
  const resolved = shown.filter((group) => group.key !== DispositionKinds.OPEN);
  return [...open, ...resolved];
}
