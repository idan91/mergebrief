import { Resvg } from "@resvg/resvg-js";

export interface RenderedImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, one byte per channel, row-major. */
  readonly pixels: Uint8Array;
  readonly png: Uint8Array;
}

/** Rasterizes an SVG at the given pixel width with no system fonts, so a run never depends on the machine. */
export function renderSvg(svg: string, width: number): RenderedImage {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  });
  const rendered = resvg.render();

  return {
    width: rendered.width,
    height: rendered.height,
    pixels: new Uint8Array(rendered.pixels),
    png: new Uint8Array(rendered.asPng()),
  };
}
