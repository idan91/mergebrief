import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
  type CompiledRule,
} from "@web/test/compiled-css";

const BLEED = "var(--main-gutter)";
const MOTION = "var(--motion-base) var(--ease-out)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const toolbarRules = readRules("./ReadingToolbar.module.scss");
const baseRules = readRules("../../../../../../styles/base.scss");
const resting = readDeclarations(toolbarRules, ".toolbar");
const stuck = readDeclarations(toolbarRules, ".toolbar[data-stuck]");
const backdrop = readDeclarations(toolbarRules, ".toolbar::before");
const stuckBackdrop = readDeclarations(
  toolbarRules,
  ".toolbar[data-stuck]::before",
);
const moving = readDeclarations(toolbarRules, ".toolbar[data-motion=on]");
const movingBackdrop = readDeclarations(
  toolbarRules,
  ".toolbar[data-motion=on]::before",
);

function readRules(path: string): CompiledRule[] {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return parseCompiledRules(compileStylesheet(file));
}

describe("ReadingToolbar stylesheet", () => {
  it("rests as a rounded panel in the story column", () => {
    expect(resting.get("border-radius")).toBe("var(--radius-panel)");
    expect(resting.get("border")).toBe("1px solid var(--color-line)");
    expect(resting.has("margin-inline")).toBe(false);
  });

  it("paints its fill on a backdrop behind the controls", () => {
    expect(backdrop.get("content")).toBe('""');
    expect(backdrop.get("position")).toBe("absolute");
    expect(backdrop.get("z-index")).toBe("-1");
    expect(backdrop.get("background")).toBe(resting.get("background"));
  });

  it("spans the backdrop across the border box and the gutters", () => {
    expect(backdrop.get("inset-block")).toBe("-2px -1px");
    expect(backdrop.get("inset-inline")).toBe(`calc(-1px - ${BLEED})`);
  });

  it("bleeds to the screen edge and the sidebar's start edge", () => {
    const main = readDeclarations(baseRules, ".main");

    expect(main.get("padding-inline")).toBe(
      `${BLEED} calc(${BLEED} + var(--sidebar-w))`,
    );
    expect(main.get("inline-size")).toBe("100%");
  });

  it("clips the backdrop inside the panel's border at rest", () => {
    expect(backdrop.get("clip-path")).toBe(
      `inset(2px calc(1px + ${BLEED}) 1px round calc(var(--radius-panel) - 1px))`,
    );
  });

  it("opens the backdrop to the full square bleed while stuck", () => {
    expect(stuckBackdrop.get("clip-path")).toBe("inset(0 round 0)");
  });

  it("keeps only the bottom hairline while stuck", () => {
    expect(stuck.get("border-color")).toBe("transparent");
    expect(backdrop.get("border-block-end")).toBe(
      "1px solid var(--color-line)",
    );
  });

  it("keeps its own box identical at rest and while stuck", () => {
    expect([...stuck.keys()]).toEqual(["border-color"]);
    expect([...moving.keys()]).toEqual(["transition"]);
  });

  it("fades the panel border and opens the backdrop on the base motion", () => {
    expect(moving.get("transition")).toBe(`border-color ${MOTION}`);
    expect(movingBackdrop.get("transition")).toBe(`clip-path ${MOTION}`);
  });

  it("holds still until its first reading has painted", () => {
    expect(resting.has("transition")).toBe(false);
    expect(backdrop.has("transition")).toBe(false);
  });

  it("switches instantly under reduced motion", () => {
    const reduced = readDeclarations(
      toolbarRules,
      ".toolbar[data-motion=on], .toolbar[data-motion=on]::before",
      REDUCED_MOTION,
    );

    expect(reduced.get("transition")).toBe("none");
  });
});
