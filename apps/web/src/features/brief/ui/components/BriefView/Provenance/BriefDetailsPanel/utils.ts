import type { TFunction } from "i18next";
import type { Brief } from "../../../../../model/types";
import { ANCHOR_WARNING_KEYS } from "./consts";

/**
 * Every warning line the panel lists and the chip counts: the anchor
 * warnings in the reader's language first, then the pipeline's own lines,
 * each once.
 */
export function listWarningLines(t: TFunction, brief: Brief): string[] {
  const anchorLines = (brief.anchorWarnings ?? []).map((warning) =>
    t(ANCHOR_WARNING_KEYS[warning]),
  );
  return [...new Set([...anchorLines, ...(brief.generationWarnings ?? [])])];
}
