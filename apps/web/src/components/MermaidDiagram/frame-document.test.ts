import { describe, expect, it } from "vitest";

import { buildDiagramDocument } from "./frame-document";
import { buildDiagramSvg } from "./test-utils";

describe("buildDiagramDocument", () => {
  const document = buildDiagramDocument(buildDiagramSvg("0 0 10 10"));

  it("holds the svg in a dark, transparent page", () => {
    expect(document).toContain('<meta name="color-scheme" content="dark">');
    expect(document).toContain("background:transparent");
    expect(document).toContain('viewBox="0 0 10 10"');
  });

  it("forbids the page every fetch and every script", () => {
    expect(document).toContain("default-src 'none'");
    expect(document).not.toContain("script-src");
  });
});
