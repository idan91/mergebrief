// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { buildDiagramSvg, buildSandboxFrameMarkup } from "./test-utils";
import { buildFrameStyle, readPixelSize, readSandboxedSvg } from "./utils";

describe("readSandboxedSvg", () => {
  it("reads the svg and its viewBox size out of the sandboxed frame", () => {
    const svg = buildDiagramSvg("-50 -10 673 311", "<g><text>A</text></g>");

    const read = readSandboxedSvg(buildSandboxFrameMarkup(svg));

    expect(read).toMatchObject({ width: 673, height: 311 });
    expect(read?.markup).toContain("<text>A</text>");
    expect(read?.markup.startsWith("<svg")).toBe(true);
  });

  it("decodes text outside ASCII as UTF-8", () => {
    const svg = buildDiagramSvg("0 0 10 10", "<text>Grüße 東京</text>");

    expect(readSandboxedSvg(buildSandboxFrameMarkup(svg))?.markup).toContain(
      "Grüße 東京",
    );
  });

  it.each([
    ["markup with no frame", buildDiagramSvg("0 0 10 10")],
    ["a frame on another source", '<iframe src="https://cdn.test/x"></iframe>'],
    ["a frame holding no svg", buildSandboxFrameMarkup("<p>none</p>")],
    [
      "a viewBox of zero width",
      buildSandboxFrameMarkup(buildDiagramSvg("0 0 0 10")),
    ],
    [
      "a viewBox with too few numbers",
      buildSandboxFrameMarkup(buildDiagramSvg("0 0 10")),
    ],
    [
      "a viewBox that is not numeric",
      buildSandboxFrameMarkup(buildDiagramSvg("a b c d")),
    ],
  ])("reads nothing from %s", (_name, markup) => {
    expect(readSandboxedSvg(markup)).toBeUndefined();
  });
});

describe("readPixelSize", () => {
  it.each([
    ["13px", 15, 13],
    ["0.8125rem", 16, 13],
    [" 1rem ", 14, 14],
  ])("reads %s against a %dpx root as %dpx", (value, rootPixels, pixels) => {
    expect(readPixelSize(value, rootPixels)).toBe(pixels);
  });

  it.each([[""], ["1em"], ["large"], ["-2px"]])(
    "reads no size from %j",
    (value) => {
      expect(readPixelSize(value, 16)).toBeUndefined();
    },
  );
});

describe("buildFrameStyle", () => {
  const diagram = { srcDoc: "", width: 900, height: 600 };

  it("keeps the viewBox ratio and caps the width at the diagram's own", () => {
    expect(buildFrameStyle(diagram, {})).toEqual({
      aspectRatio: "900 / 600",
      maxInlineSize: "900px",
    });
  });

  it("never draws below the smallest scale, scrolling instead", () => {
    expect(buildFrameStyle(diagram, { minScale: 0.75 })).toEqual({
      aspectRatio: "900 / 600",
      maxInlineSize: "900px",
      minInlineSize: "675px",
    });
  });

  it("narrows a tall diagram to fit a height, keeping its ratio", () => {
    const tall = { srcDoc: "", width: 900, height: 2400 };

    expect(buildFrameStyle(tall, { maxBlockSize: 320 })).toEqual({
      aspectRatio: "900 / 2400",
      maxInlineSize: "120px",
    });
  });

  it("leaves a short diagram at its own width under a height cap", () => {
    expect(buildFrameStyle(diagram, { maxBlockSize: 900 })).toEqual({
      aspectRatio: "900 / 600",
      maxInlineSize: "900px",
    });
  });
});
