import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "types/utils";

import { MARK_MASTER_FILE, WORDMARK_MASTER_FILE } from "./consts";
import type { BrandMasters, VectorMaster, ViewBox } from "./types";

const VIEW_BOX_PATTERN = /viewBox="([-\d.\s]+)"/;
const PATH_DATA_PATTERN = /\sd="([^"]+)"/;
const VIEW_BOX_FIELDS = 4;

function parseViewBox(raw: string): ViewBox | undefined {
  const numbers = raw.trim().split(/\s+/).map(Number);
  const [x, y, width, height] = numbers;
  const wellFormed =
    numbers.length === VIEW_BOX_FIELDS && numbers.every(Number.isFinite);

  if (
    !wellFormed ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }

  return { x, y, width, height };
}

/** Reads a one-path master SVG back into its view box and path data. */
export function parseVectorMaster(svg: string): Result<VectorMaster, string> {
  const viewBoxMatch = VIEW_BOX_PATTERN.exec(svg);
  const pathMatch = PATH_DATA_PATTERN.exec(svg);
  const viewBox = viewBoxMatch?.[1] ? parseViewBox(viewBoxMatch[1]) : undefined;
  const pathData = pathMatch?.[1];

  if (!viewBox) {
    return { ok: false, error: "master has no numeric viewBox" };
  }
  if (!pathData) {
    return { ok: false, error: "master has no path data" };
  }

  return { ok: true, value: { viewBox, pathData } };
}

export function formatViewBox(viewBox: ViewBox): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

/** Reads both masters from the tool's own folder. */
export function loadBrandMasters(
  toolRoot: string,
): Result<BrandMasters, string> {
  const markSvg = readFileSync(join(toolRoot, MARK_MASTER_FILE), "utf8");
  const wordmarkSvg = readFileSync(
    join(toolRoot, WORDMARK_MASTER_FILE),
    "utf8",
  );
  const mark = parseVectorMaster(markSvg);
  const wordmark = parseVectorMaster(wordmarkSvg);

  if (!mark.ok) {
    return { ok: false, error: `${MARK_MASTER_FILE}: ${mark.error}` };
  }
  if (!wordmark.ok) {
    return { ok: false, error: `${WORDMARK_MASTER_FILE}: ${wordmark.error}` };
  }

  return { ok: true, value: { mark: mark.value, wordmark: wordmark.value } };
}
