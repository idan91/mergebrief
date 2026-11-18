import {
  findPossiblyHiddenMarkup,
  normalizeLineBreaks,
  removeHiddenCharacters,
  type TextRange,
} from "../../generation/untrusted-text";
import type { Mutable } from "types/utils";
import { createEmbeddedUrlCheck } from "../embedded-urls";
import { LEADING_BOM, EMPTY_LABEL_LINK } from "./consts";
import type { HtmlBlocks } from "./types";
import {
  collectHtmlBlocks,
  collectMarkerBlocks,
  extendCrossingComments,
  collectTagRanges,
} from "./html";
import {
  collectImageRanges,
  collectTitleRanges,
  collectExcessCellRanges,
  collectFenceInfoRanges,
  collectReferenceLabelRanges,
} from "./markdown";

/** Overlapping ranges as one run each, in order. */
function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = ranges.toSorted((left, right) => left.start - right.start);
  const runs: Mutable<TextRange>[] = [];

  for (const range of sorted) {
    const run = runs.at(-1);
    if (run === undefined || range.start >= run.end) {
      runs.push({ ...range });
      continue;
    }
    run.end = Math.max(run.end, range.end);
  }
  return runs;
}

/**
 * Each run becomes one space so the words around it never join; a run
 * starting inside what reads as a URL joins its neighbours instead, so
 * removing it cannot cut the URL into two link starts.
 */
function removeRanges(text: string, ranges: readonly TextRange[]): string {
  const isInUrl = createEmbeddedUrlCheck(text);
  const kept: string[] = [];
  let cursor = 0;

  for (const run of mergeRanges(ranges)) {
    const separator = isInUrl(run.start) ? "" : " ";
    kept.push(text.slice(cursor, run.start), separator);
    cursor = run.end;
  }

  kept.push(text.slice(cursor));
  return kept.join("");
}

/**
 * The description as GitHub shows it to the reviewer, for the reference and
 * link extractors: hidden markup, HTML tags with their attributes, images,
 * link titles, reference labels, fence info strings, table cells past the
 * columns and the targets of links that show no label are gone. Every pass reads the raw
 * text, as GitHub's parser does, and their ranges go together. Where telling
 * hidden from shown takes a full parse, a pass removes more; each is linear,
 * so a crafted description cannot stall the worker.
 */
export function extractVisibleText(text: string): string {
  const prose = normalizeLineBreaks(text).replace(LEADING_BOM, "");
  const blocks: HtmlBlocks = {
    regions: collectHtmlBlocks(prose),
    markerBlocks: collectMarkerBlocks(prose),
  };
  const hidden = findPossiblyHiddenMarkup(prose);
  const ranges = [
    ...extendCrossingComments(prose, hidden, blocks),
    ...collectTagRanges(prose, blocks),
    ...collectImageRanges(prose),
    ...collectTitleRanges(prose),
    ...collectExcessCellRanges(prose),
    ...collectFenceInfoRanges(prose),
    ...collectReferenceLabelRanges(prose),
  ];
  const visible = removeHiddenCharacters(removeRanges(prose, ranges));
  const isInUrl = createEmbeddedUrlCheck(visible);
  return visible.replace(EMPTY_LABEL_LINK, (_link, offset: number) =>
    isInUrl(offset) ? "" : " ",
  );
}
