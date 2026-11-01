import { describe, expect, it } from "vitest";

import {
  createSyntaxContrastTransformer,
  liftLightCommentColor,
} from "../src/syntax";

describe("liftLightCommentColor", () => {
  it("lifts the light comment grey and keeps the dark value", () => {
    expect(
      liftLightCommentColor("--shiki-light:#6E7781;--shiki-dark:#8B949E"),
    ).toBe("--shiki-light:#656d76;--shiki-dark:#8B949E");
  });

  it("leaves every other token colour alone", () => {
    const style = "--shiki-light:#CF222E;--shiki-dark:#6E7781";

    expect(liftLightCommentColor(style)).toBe(style);
  });
});

describe("createSyntaxContrastTransformer", () => {
  it("rewrites the style on each highlighted span", () => {
    const span = {
      type: "element",
      tagName: "span",
      properties: { style: "--shiki-light:#6E7781;--shiki-dark:#8B949E" },
      children: [],
    };

    createSyntaxContrastTransformer().span?.call(
      {} as never,
      span as never,
      1,
      1,
      span as never,
      {} as never,
    );

    expect(span.properties.style).toBe(
      "--shiki-light:#656d76;--shiki-dark:#8B949E",
    );
  });
});
