// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMermaidConfig, readReadableScale } from "./theme";

function stubRoot(sizes: string): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("style", sizes);
  document.body.append(root);
  return root;
}

/** The pixel a real canvas paints for each token value the tests use; any other paints nothing. */
const PAINTED_PIXELS: Readonly<Record<string, readonly number[]>> = {
  "oklch(0.2 0.01 250)": [10, 20, 30, 255],
  "oklch(0.9 0 0 / 20%)": [200, 210, 220, 51],
};
const UNPAINTED_PIXEL = [0, 0, 0, 0];

class StubCanvasContext {
  fillStyle = "";
  private pixel: readonly number[] = UNPAINTED_PIXEL;

  clearRect(): void {
    this.pixel = UNPAINTED_PIXEL;
  }

  fillRect(): void {
    this.pixel = PAINTED_PIXELS[this.fillStyle] ?? UNPAINTED_PIXEL;
  }

  getImageData(): { data: Uint8ClampedArray } {
    return { data: Uint8ClampedArray.from(this.pixel) };
  }
}

class StubOffscreenCanvas {
  getContext(): StubCanvasContext {
    return new StubCanvasContext();
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("buildMermaidConfig", () => {
  it("draws the classic look, which has no drop shadow", () => {
    const config = buildMermaidConfig(stubRoot("--font-size-2: 13px"));

    expect(config.look).toBe("classic");
  });

  it("lays out with dagre, so elkjs loads only for a diagram asking it", () => {
    const config = buildMermaidConfig(stubRoot("--font-size-2: 13px"));

    expect(config.layout).toBe("dagre");
  });

  it("paints each theme token and reads it back as rgb", () => {
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
    const root = stubRoot(
      "--color-ground: oklch(0.2 0.01 250); --color-text-1: oklch(0.9 0 0 / 20%); --color-surface-2: nonsense",
    );

    const config = buildMermaidConfig(root);

    expect(config.themeVariables).toMatchObject({
      background: "rgb(10, 20, 30)",
      primaryTextColor: "rgba(200, 210, 220, 0.2)",
    });
    expect(config.themeVariables).not.toHaveProperty("primaryColor");
  });

  it("keeps Mermaid's own colours where nothing paints off screen", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const root = stubRoot("--color-ground: oklch(0.2 0.01 250)");

    expect(buildMermaidConfig(root).themeVariables).not.toHaveProperty(
      "background",
    );
  });

  it("draws sequence text at the size every other diagram uses", () => {
    const config = buildMermaidConfig(stubRoot("--font-size-2: 13px"));

    expect(config.themeVariables).toMatchObject({ fontSize: "13px" });
    expect(config.fontSize).toBe(13);
  });
});

describe("readReadableScale", () => {
  it("is the smallest text size over the diagram's text size", () => {
    const root = stubRoot("--font-size-2: 13px; --font-size-1: 11px");

    expect(readReadableScale(root)).toBeCloseTo(11 / 13);
  });

  it("is absent when the smallest text size cannot be read", () => {
    const root = stubRoot("--font-size-2: 13px");

    expect(readReadableScale(root)).toBeUndefined();
  });
});
