import type { CSSProperties } from "react";

import { SANDBOX_FRAME_SOURCE_PREFIX } from "./consts";
import type { DiagramSvg, RenderedDiagram } from "./types";

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

/**
 * The frame's size: the viewBox's ratio, never wider than the diagram drew
 * itself, and never narrower than its readable scale; a narrower host
 * scrolls sideways.
 */
export function buildFrameStyle(diagram: RenderedDiagram): CSSProperties {
  const style: CSSProperties = {
    aspectRatio: `${diagram.width} / ${diagram.height}`,
    maxInlineSize: `${diagram.width}px`,
  };
  if (diagram.readableScale !== undefined) {
    const readableWidth = Math.ceil(diagram.width * diagram.readableScale);
    style.minInlineSize = `${readableWidth}px`;
  }
  return style;
}
