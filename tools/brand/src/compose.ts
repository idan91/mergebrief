import {
  LOCKUP_GAP_EM,
  LOCKUP_MARK_EM,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  SHARE_WORDMARK_EM,
  SVG_NAMESPACE,
  TILE_MARK_SHARE,
  WORDMARK_UNITS_PER_EM,
} from "./consts";
import type { VectorMaster } from "./types";

export interface LockupColors {
  readonly ground: string;
  readonly mark: string;
  readonly wordmark: string;
}

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

function drawPath(
  master: VectorMaster,
  placement: Placement,
  fill: string,
  fillRule: "evenodd" | "nonzero",
): string {
  const { x, y, scale } = placement;
  const originX = x - master.viewBox.x * scale;
  const originY = y - master.viewBox.y * scale;

  return `  <path transform="translate(${originX} ${originY}) scale(${scale})" fill="${fill}" fill-rule="${fillRule}" d="${master.pathData}"/>`;
}

/** A square tile with the mark centred on it: the touch icon and the bot avatar. */
export function buildTileSvg(
  mark: VectorMaster,
  size: number,
  tileColor: string,
  markColor: string,
): string {
  const markSize = size * TILE_MARK_SHARE;
  const inset = (size - markSize) / 2;
  const placement = {
    x: inset,
    y: inset,
    scale: markSize / mark.viewBox.width,
  };

  return [
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 ${size} ${size}">`,
    `  <rect width="${size}" height="${size}" fill="${tileColor}"/>`,
    drawPath(mark, placement, markColor, "evenodd"),
    "</svg>",
    "",
  ].join("\n");
}

/** The header lockup, mark then wordmark on the cap line, centred on the share image's ground. */
export function buildShareImageSvg(
  mark: VectorMaster,
  wordmark: VectorMaster,
  colors: LockupColors,
): string {
  const em = SHARE_WORDMARK_EM;
  const markSize = LOCKUP_MARK_EM * em;
  const gap = LOCKUP_GAP_EM * em;
  const wordmarkScale = em / WORDMARK_UNITS_PER_EM;
  const wordmarkWidth = wordmark.viewBox.width * wordmarkScale;
  const wordmarkHeight = wordmark.viewBox.height * wordmarkScale;
  const lockupWidth = markSize + gap + wordmarkWidth;
  const left = (SHARE_IMAGE_WIDTH - lockupWidth) / 2;
  const centreY = SHARE_IMAGE_HEIGHT / 2;
  const markPlacement = {
    x: left,
    y: centreY - markSize / 2,
    scale: markSize / mark.viewBox.width,
  };
  const wordmarkPlacement = {
    x: left + markSize + gap,
    y: centreY - wordmarkHeight / 2,
    scale: wordmarkScale,
  };

  return [
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 ${SHARE_IMAGE_WIDTH} ${SHARE_IMAGE_HEIGHT}">`,
    `  <rect width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" fill="${colors.ground}"/>`,
    drawPath(mark, markPlacement, colors.mark, "evenodd"),
    drawPath(wordmark, wordmarkPlacement, colors.wordmark, "nonzero"),
    "</svg>",
    "",
  ].join("\n");
}
