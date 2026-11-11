import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const CARD_STYLESHEET = fileURLToPath(
  new URL("./ChunkCard.module.scss", import.meta.url),
);
const rules = parseCompiledRules(compileStylesheet(CARD_STYLESHEET));

const TOP_RADII = ["border-start-start-radius", "border-start-end-radius"];
const MOTION = "var(--motion-base) var(--ease-out)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function readTopRadii(selector: string): (string | undefined)[] {
  const declarations = readDeclarations(rules, selector);
  return TOP_RADII.map((property) => declarations.get(property));
}

describe("ChunkCard stylesheet", () => {
  it("shows the chunk tools while keyboard focus is in the head", () => {
    const reveal = rules.find((rule) =>
      rule.selectors.some(
        (selector) =>
          selector.includes(".head:has(:focus-visible)") &&
          selector.includes(".tools"),
      ),
    );

    expect(reveal?.declarations.get("opacity")).toBe("1");
  });

  it("rounds the head's top corners at rest", () => {
    expect(readTopRadii(".head")).toEqual([
      "var(--radius-lg)",
      "var(--radius-lg)",
    ]);
  });

  it("squares the head's top corners only while it is stuck", () => {
    const squared = rules.filter((rule) =>
      TOP_RADII.some((property) => rule.declarations.get(property) === "0"),
    );

    expect(readTopRadii(".head[data-stuck]")).toEqual(["0", "0"]);
    expect(squared.flatMap((rule) => rule.selectors)).toEqual([
      ".head[data-stuck]",
    ]);
  });

  it("gives the phone head's menu the head's own corner", () => {
    const menus = rules.filter(
      (rule) =>
        rule.selectors.includes(".head .actions") &&
        rule.declarations.has("border-start-end-radius"),
    );

    expect(menus.length).toBeGreaterThan(0);
    expect(
      menus.map((rule) => rule.declarations.get("border-start-end-radius")),
    ).toEqual(menus.map(() => "inherit"));
  });

  it("leaves the menu's press and hover transitions to IconButton", () => {
    const restyled = rules.filter((rule) =>
      rule.selectors.some((selector) => selector.endsWith(".actions")),
    );

    expect(restyled.some((rule) => rule.declarations.has("transition"))).toBe(
      false,
    );
  });

  it("eases the head's top corners on the base motion", () => {
    const moving = readDeclarations(rules, ".head[data-motion=on]");

    expect(moving.get("transition")).toBe(
      TOP_RADII.map((property) => `${property} ${MOTION}`).join(", "),
    );
  });

  it("holds the head still until its first reading has painted", () => {
    expect(readDeclarations(rules, ".head").has("transition")).toBe(false);
  });

  it("squares the head instantly under reduced motion", () => {
    const reduced = readDeclarations(
      rules,
      ".head[data-motion=on]",
      REDUCED_MOTION,
    );

    expect(reduced.get("transition")).toBe("none");
  });
});
