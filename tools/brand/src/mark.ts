import {
  MARK_GRID_CELLS,
  PIXEL_CELL_SIZE,
  PIXEL_ICON_SIZE,
  SVG_NAMESPACE,
} from "./consts";
import { formatViewBox } from "./master";
import { renderSvg } from "./raster";
import type { MarkCell, VectorMaster } from "./types";

const SAMPLE_PIXELS_PER_CELL = 20;
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;
const OPAQUE_THRESHOLD = 128;

/** The mark as a standalone SVG in one fill colour (`currentColor` for an inline icon). */
export function buildMarkSvg(mark: VectorMaster, fill: string): string {
  return [
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="${formatViewBox(mark.viewBox)}">`,
    `  <path fill="${fill}" fill-rule="evenodd" d="${mark.pathData}"/>`,
    "</svg>",
    "",
  ].join("\n");
}

/** Which grid cells the master fills, read by sampling each cell's centre. */
export function findMarkCells(mark: VectorMaster): MarkCell[] {
  const size = MARK_GRID_CELLS * SAMPLE_PIXELS_PER_CELL;
  const image = renderSvg(buildMarkSvg(mark, "#000"), size);
  const cells: MarkCell[] = [];

  for (let row = 0; row < MARK_GRID_CELLS; row += 1) {
    for (let column = 0; column < MARK_GRID_CELLS; column += 1) {
      const centreX =
        column * SAMPLE_PIXELS_PER_CELL + SAMPLE_PIXELS_PER_CELL / 2;
      const centreY = row * SAMPLE_PIXELS_PER_CELL + SAMPLE_PIXELS_PER_CELL / 2;
      const offset = (centreY * image.width + centreX) * RGBA_CHANNELS;
      const alpha = image.pixels[offset + ALPHA_CHANNEL] ?? 0;

      if (alpha >= OPAQUE_THRESHOLD) {
        cells.push({ column, row });
      }
    }
  }

  return cells;
}

/** The 16px icon: each filled cell a whole 3px square, so nothing is anti-aliased. */
export function buildPixelMarkSvg(
  cells: readonly MarkCell[],
  fill: string,
): string {
  const squares = cells.map((cell) => {
    const x = cell.column * PIXEL_CELL_SIZE;
    const y = cell.row * PIXEL_CELL_SIZE;

    return `  <rect x="${x}" y="${y}" width="${PIXEL_CELL_SIZE}" height="${PIXEL_CELL_SIZE}"/>`;
  });

  return [
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 ${PIXEL_ICON_SIZE} ${PIXEL_ICON_SIZE}" shape-rendering="crispEdges" fill="${fill}">`,
    ...squares,
    "</svg>",
    "",
  ].join("\n");
}
