import type { Font, VariationCoordinates } from "opentype.js";

import {
  SVG_NAMESPACE,
  WORDMARK_COORDINATE_DECIMALS,
  WORDMARK_TEXT,
  WORDMARK_TRACKING_EM,
  WORDMARK_UNITS_PER_EM,
  WORDMARK_WEIGHT_AXIS,
  WORDMARK_WIDTH_AXIS,
} from "./consts";
import { formatViewBox } from "./master";
import type { VectorMaster, ViewBox } from "./types";

const WORDMARK_VARIATION: VariationCoordinates = {
  wdth: WORDMARK_WIDTH_AXIS,
  wght: WORDMARK_WEIGHT_AXIS,
};
const CAP_REFERENCE = "M";
const DESCENDER_REFERENCE = "g";

function measureGlyphBox(font: Font, character: string) {
  return font
    .charToGlyph(character)
    .getPath(
      0,
      0,
      WORDMARK_UNITS_PER_EM,
      { variation: WORDMARK_VARIATION },
      font,
    )
    .getBoundingBox();
}

function roundCoordinate(value: number): number {
  const factor = 10 ** WORDMARK_COORDINATE_DECIMALS;

  return Math.round(value * factor) / factor;
}

/**
 * Sets the wordmark at 1000 units per em on the baseline (y = 0), kerned and
 * tracked as CSS would set it, and returns its outline. The view box is the
 * ink's width and a height centred on the cap height, so a flex row that
 * centres it centres the capitals, not the capitals plus the g's tail.
 */
export function outlineWordmark(font: Font): VectorMaster {
  // Glyph by glyph rather than `stringToGlyphs`: opentype.js 2 cannot run
  // Archivo's ccmp lookup, and the word holds no ligature to form.
  const glyphs = WORDMARK_TEXT.split("").map((character) =>
    font.charToGlyph(character),
  );
  const kerningLookups = font.position.getKerningTables(
    font.position.getDefaultScriptName(),
  );
  const scale = WORDMARK_UNITS_PER_EM / font.unitsPerEm;
  const tracking = WORDMARK_TRACKING_EM * WORDMARK_UNITS_PER_EM;
  const pathParts: string[] = [];
  let penX = 0;
  let inkLeft = Number.POSITIVE_INFINITY;
  let inkRight = Number.NEGATIVE_INFINITY;

  for (const [index, glyph] of glyphs.entries()) {
    const path = glyph.getPath(
      penX,
      0,
      WORDMARK_UNITS_PER_EM,
      { variation: WORDMARK_VARIATION },
      font,
    );
    const box = path.getBoundingBox();
    const varied = font.variation.getTransform(glyph, WORDMARK_VARIATION);
    const next = glyphs[index + 1];

    inkLeft = Math.min(inkLeft, box.x1);
    inkRight = Math.max(inkRight, box.x2);
    pathParts.push(
      path.toPathData({
        decimalPlaces: WORDMARK_COORDINATE_DECIMALS,
        flipY: false,
        optimize: true,
      }),
    );
    penX += (varied.advanceWidth ?? 0) * scale;
    if (next) {
      const kerning = font.position.getKerningValue(
        kerningLookups,
        glyph.index,
        next.index,
      );

      penX += kerning * scale + tracking;
    }
  }

  const capHeight = -measureGlyphBox(font, CAP_REFERENCE).y1;
  const descent = measureGlyphBox(font, DESCENDER_REFERENCE).y2;
  const viewBox: ViewBox = {
    x: roundCoordinate(inkLeft),
    y: roundCoordinate(-capHeight - descent),
    width: roundCoordinate(inkRight - inkLeft),
    height: roundCoordinate(capHeight + 2 * descent),
  };

  return { viewBox, pathData: pathParts.join("") };
}

/** The master file: the outline in `currentColor`, sized by its view box alone. */
export function buildWordmarkMasterSvg(wordmark: VectorMaster): string {
  return [
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="${formatViewBox(wordmark.viewBox)}">`,
    `  <path fill="currentColor" d="${wordmark.pathData}"/>`,
    "</svg>",
    "",
  ].join("\n");
}

/**
 * The inline wordmark: width and height in em, so it sizes from the
 * surrounding font size the way the text it replaces did.
 */
export function buildInlineWordmarkSvg(wordmark: VectorMaster): string {
  const width = wordmark.viewBox.width / WORDMARK_UNITS_PER_EM;
  const height = wordmark.viewBox.height / WORDMARK_UNITS_PER_EM;

  return [
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="${formatViewBox(wordmark.viewBox)}" width="${width}em" height="${height}em">`,
    `  <path fill="currentColor" d="${wordmark.pathData}"/>`,
    "</svg>",
    "",
  ].join("\n");
}
