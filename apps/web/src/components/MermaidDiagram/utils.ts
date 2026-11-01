import type { CSSProperties } from "react";

import { SANDBOX_FRAME_SOURCE_PREFIX } from "./consts";
import type { DiagramSvg, FrameBounds, RenderedDiagram } from "./types";

const VIEW_BOX_SEPARATOR = /[\s,]+/;
const VIEW_BOX_PARTS = 4;
const PIXEL_SIZE = /^(\d+(?:\.\d+)?)(px|rem)$/;

/** A DOMParser document has no browsing context: nothing in it runs or fetches. */
function parseInertHtml(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

function decodeUtf8Base64(encoded: string): string | undefined {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function readViewBoxSize(
  svg: Element,
): { width: number; height: number } | undefined {
  const parts = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(VIEW_BOX_SEPARATOR);
  const [, , width = Number.NaN, height = Number.NaN] = parts.map(Number);
  const isSized = parts.length === VIEW_BOX_PARTS && width > 0 && height > 0;
  return isSized ? { width, height } : undefined;
}

/**
 * The SVG inside the frame markup Mermaid's sandbox mode returns, read
 * through an inert parser; anything else, or an SVG with no usable
 * viewBox, reads as none.
 */
export function readSandboxedSvg(frameMarkup: string): DiagramSvg | undefined {
  const source = parseInertHtml(frameMarkup)
    .querySelector("iframe")
    ?.getAttribute("src");
  if (source?.startsWith(SANDBOX_FRAME_SOURCE_PREFIX) !== true) {
    return undefined;
  }
  const encoded = source.slice(SANDBOX_FRAME_SOURCE_PREFIX.length);
  const page = decodeUtf8Base64(encoded);
  const svg =
    page === undefined ? null : parseInertHtml(page).body.querySelector("svg");
  const size = svg === null ? undefined : readViewBoxSize(svg);
  const isUnreadable = svg === null || size === undefined;
  if (isUnreadable) {
    return undefined;
  }

  return { markup: svg.outerHTML, ...size };
}

/** A `px` or `rem` length in pixels, `rem` against `rootPixels`; any other unit reads as none. */
export function readPixelSize(
  value: string,
  rootPixels: number,
): number | undefined {
  const match = PIXEL_SIZE.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const [, amount = "", unit] = match;
  const size = Number(amount);
  return unit === "rem" ? size * rootPixels : size;
}

/** The widest the frame draws, in whole pixels: the diagram's own width, narrowed to fit `maxBlockSize`. */
export function readFrameMaxWidth(
  diagram: RenderedDiagram,
  maxBlockSize: number | undefined,
): number {
  const ratio = diagram.width / diagram.height;
  const cappedWidth =
    maxBlockSize === undefined ? diagram.width : maxBlockSize * ratio;
  const maxWidth = Math.floor(Math.min(diagram.width, cappedWidth));
  return maxWidth;
}

/**
 * The frame's size: the viewBox's ratio, never wider than the diagram drew
 * itself nor taller than `maxBlockSize`, and never narrower than `minScale`
 * draws it; a narrower host scrolls sideways.
 */
export function buildFrameStyle(
  diagram: RenderedDiagram,
  { maxBlockSize, minScale }: FrameBounds,
): CSSProperties {
  const maxWidth = readFrameMaxWidth(diagram, maxBlockSize);
  const style: CSSProperties = {
    aspectRatio: `${diagram.width} / ${diagram.height}`,
    maxInlineSize: `${maxWidth}px`,
  };
  if (minScale !== undefined) {
    style.minInlineSize = `${Math.ceil(diagram.width * minScale)}px`;
  }
  return style;
}
