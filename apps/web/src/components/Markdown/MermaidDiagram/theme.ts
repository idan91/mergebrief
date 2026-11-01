import type { MermaidConfig } from "mermaid";

import {
  DIAGRAM_FONT_FAMILY,
  DIAGRAM_FONT_SIZE_TOKEN,
  DIAGRAM_MIN_FONT_SIZE_TOKEN,
  DIAGRAM_THEME_TOKENS,
  MERMAID_DEFAULT_FONT_PIXELS,
  MERMAID_LAYOUT,
} from "./consts";
import type { DesignToken } from "./types";
import { readPixelSize } from "./utils";

const OPAQUE_ALPHA = 255;
const UNPAINTED_FILL = "transparent";

/**
 * A token's colour as `rgb()`, read back from a painted pixel: the tokens
 * are `oklch()`, which Mermaid's colour maths cannot parse. A value the
 * canvas refuses paints nothing and reads as none.
 */
function readTokenColor(
  context: OffscreenCanvasRenderingContext2D,
  value: string,
): string | undefined {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = UNPAINTED_FILL;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);

  const pixel = context.getImageData(0, 0, 1, 1).data;
  const [red = 0, green = 0, blue = 0, alpha = 0] = pixel;
  if (alpha === 0) {
    return undefined;
  }

  const channels = `${red}, ${green}, ${blue}`;
  return alpha === OPAQUE_ALPHA
    ? `rgb(${channels})`
    : `rgba(${channels}, ${alpha / OPAQUE_ALPHA})`;
}

/** Each theme variable's token resolved against `root`; none where the browser cannot paint off screen. */
function readThemeColors(root: HTMLElement): Record<string, string> {
  const colors: Record<string, string> = {};
  const canvas =
    typeof OffscreenCanvas === "undefined"
      ? undefined
      : new OffscreenCanvas(1, 1);
  const context = canvas?.getContext("2d", { willReadFrequently: true });
  if (context === undefined || context === null) {
    return colors;
  }

  const style = getComputedStyle(root);
  for (const [variable, token] of Object.entries(DIAGRAM_THEME_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    const color = value === "" ? undefined : readTokenColor(context, value);
    if (color !== undefined) {
      colors[variable] = color;
    }
  }
  return colors;
}

function readTokenPixels(
  root: HTMLElement,
  token: DesignToken,
): number | undefined {
  const style = getComputedStyle(root);
  const rootPixels = Number.parseFloat(style.fontSize);
  return readPixelSize(style.getPropertyValue(token), rootPixels);
}

/**
 * The smallest scale a frame may draw a diagram at with its text still at
 * the app's smallest size; absent when that size cannot be read.
 */
export function readReadableScale(root: HTMLElement): number | undefined {
  const minimumPixels = readTokenPixels(root, DIAGRAM_MIN_FONT_SIZE_TOKEN);
  const fontPixels =
    readTokenPixels(root, DIAGRAM_FONT_SIZE_TOKEN) ??
    MERMAID_DEFAULT_FONT_PIXELS;
  return minimumPixels === undefined ? undefined : minimumPixels / fontPixels;
}

/**
 * Mermaid's settings: sandboxed, dark, in the page's tokens and the system
 * sans, every diagram type's text at one size. The classic look, since the
 * default draws a light drop shadow round every shape. Dagre lays out every
 * diagram that names no layout, so elkjs loads only for one that asks.
 */
export function buildMermaidConfig(root: HTMLElement): MermaidConfig {
  const themeVariables: Record<string, string | boolean> = {
    ...readThemeColors(root),
    darkMode: true,
    fontFamily: DIAGRAM_FONT_FAMILY,
  };
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: "sandbox",
    suppressErrorRendering: true,
    theme: "base",
    look: "classic",
    layout: MERMAID_LAYOUT,
    fontFamily: DIAGRAM_FONT_FAMILY,
    themeVariables,
  };

  const fontPixels = readTokenPixels(root, DIAGRAM_FONT_SIZE_TOKEN);
  if (fontPixels !== undefined) {
    themeVariables["fontSize"] = `${fontPixels}px`;
    // A sequence diagram sizes its actors, messages and notes from this one, never the theme's.
    config.fontSize = fontPixels;
  }
  return config;
}
