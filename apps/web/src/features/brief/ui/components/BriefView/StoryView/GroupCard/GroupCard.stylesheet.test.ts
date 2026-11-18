import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
} from "@web/test/compiled-css";

const TOP_RADII = ["border-start-start-radius", "border-start-end-radius"];
const MOTION = "var(--motion-base) var(--ease-out)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const rules = parseCompiledRules(
  compileStylesheet(
    fileURLToPath(new URL("./GroupCard.module.scss", import.meta.url)),
  ),
);

function readTopRadii(selector: string): (string | undefined)[] {
  const declarations = readDeclarations(rules, selector);
  return TOP_RADII.map((property) => declarations.get(property));
}

describe("GroupCard stylesheet", () => {
  it("rounds every corner of the card at rest", () => {
    expect(readDeclarations(rules, ".card").get("border-radius")).toBe(
      "var(--radius-lg)",
    );
  });

  it("squares the card's top corners only while it is stuck", () => {
    const squared = rules.filter((rule) =>
      TOP_RADII.some((property) => rule.declarations.get(property) === "0"),
    );

    expect(readTopRadii(".card[data-stuck]")).toEqual(["0", "0"]);
    expect(squared.flatMap((rule) => rule.selectors)).toEqual([
      ".card[data-stuck]",
    ]);
  });

  it("eases the card's top corners on the base motion", () => {
    const moving = readDeclarations(rules, ".card[data-motion=on]");

    expect(moving.get("transition")).toBe(
      TOP_RADII.map((property) => `${property} ${MOTION}`).join(", "),
    );
  });

  it("holds the card still until its first reading has painted", () => {
    expect(readDeclarations(rules, ".card").has("transition")).toBe(false);
  });

  it("squares the card instantly under reduced motion", () => {
    const reduced = readDeclarations(
      rules,
      ".card[data-motion=on]",
      REDUCED_MOTION,
    );

    expect(reduced.get("transition")).toBe("none");
  });
});
