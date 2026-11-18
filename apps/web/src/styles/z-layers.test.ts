import { describe, expect, it } from "vitest";

import { compileScss, parseCompiledRules } from "../test/compiled-css";

function readLayerValue(name: string): number {
  const css = compileScss(
    `@use "functions";\na { z-index: functions.get-z-index("${name}"); }`,
  );
  const [rule] = parseCompiledRules(css);
  return Number(rule?.declarations.get("z-index"));
}

describe("z-index layers", () => {
  it("stacks a later layer above an earlier one", () => {
    expect(readLayerValue("modal")).toBeGreaterThan(readLayerValue("header"));
  });

  it("paints the header and its progress bar over the reanchor banner", () => {
    expect(readLayerValue("header")).toBeGreaterThan(
      readLayerValue("reanchor-banner"),
    );
  });

  it("paints the toast over every popover, menu and their scrim", () => {
    expect(readLayerValue("toast")).toBeGreaterThan(readLayerValue("popover"));
  });

  it("keeps the lowest layer above the local band", () => {
    expect(readLayerValue("raised")).toBeGreaterThan(1);
  });

  it("fails the build on an unknown layer", () => {
    expect(() => readLayerValue("overlay")).toThrow(/Unknown z-index layer/);
  });
});
