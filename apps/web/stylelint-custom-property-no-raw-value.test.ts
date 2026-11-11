import { fileURLToPath } from "node:url";

import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

const CONFIG_FILE = fileURLToPath(
  new URL("./.stylelintrc.json", import.meta.url),
);
const RULE = "house/custom-property-no-raw-value";
const MODULE_FILE = "./src/probe.module.scss";

async function lintCustomProperty(
  value: string,
  file = MODULE_FILE,
): Promise<string[]> {
  const { results } = await stylelint.lint({
    code: `.row {\n  --probe: ${value};\n\n  color: var(--probe);\n}\n`,
    codeFilename: fileURLToPath(new URL(file, import.meta.url)),
    configFile: CONFIG_FILE,
  });
  const rules = results.flatMap((result) =>
    result.warnings.map((warning) => warning.rule),
  );
  return rules.filter((rule) => rule === RULE);
}

async function lintSassVariable(declaration: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    code: `${declaration};\n\n.row {\n  color: var(--probe);\n}\n`,
    codeFilename: fileURLToPath(new URL(MODULE_FILE, import.meta.url)),
    configFile: CONFIG_FILE,
  });
  const rules = results.flatMap((result) =>
    result.warnings.map((warning) => warning.rule),
  );
  return rules.filter((rule) => rule === RULE);
}

describe("house/custom-property-no-raw-value", () => {
  it.each([
    "rgb(0 0 0 / 55%)",
    "rgba(0, 0, 0, 0.5)",
    "hsl(10 50% 50%)",
    "#e1e1e1",
    "#fff",
    "inset 2px 0 0 var(--color-accent)",
    "inset 0 0 0 1px var(--color-line-strong)",
    "0 8px 14px -8px var(--color-scrim)",
    "0 0 0 0.5px var(--color-line-strong)",
    "inset 0 0 0 #{$stroke} var(--color-text-3)",
    "inset #{$bar} 0 0 var(--color-accent)",
    "inset #{2px} 0 0 var(--color-accent)",
    "0 0 0 #{functions.to-rem(2px)} var(--color-accent)",
  ])("flags %s in a module custom property", async (value) => {
    expect(await lintCustomProperty(value)).toEqual([RULE]);
  });

  it.each([
    "var(--shadow-float)",
    "#{functions.edge-bar(var(--row-hue))}",
    "#{functions.inset-ring(var(--color-text-3), 1.5px)}",
    "color-mix(in srgb, var(--color-warning) var(--tint-medium), transparent)",
    "#{functions.to-rem(14px)}",
    "calc(100% - 8px)",
    "repeating-linear-gradient(-45deg, transparent 0 6px, var(--x) 6px 7px)",
    "max(0px, calc(var(--focus-overlap) + var(--focus-panel-inset)))",
    "#{$bar-h}",
    "calc(var(--skeleton-digits) * 1ch + #{$cell-pad * 2})",
  ])("passes %s", async (value) => {
    expect(await lintCustomProperty(value)).toEqual([]);
  });

  it.each([
    "$c: rgb(0 0 0 / 80%)",
    "$c: #000",
    "$s: 0 8px 14px -8px var(--color-scrim)",
    "$ring: inset 0 0 0 $stroke var(--color-text-3)",
    "$ring: 0 0 0 functions.to-rem(2px) var(--color-accent)",
    "$bar: inset #{$w} 0 0 var(--color-accent)",
  ])("flags %s in a module Sass variable", async (declaration) => {
    expect(await lintSassVariable(declaration)).toEqual([RULE]);
  });

  it.each([
    "$bar-h: 8px",
    "$sign-stroke: 1.5px",
    "$sign-w: functions.to-rem(16px)",
    "$gap: functions.to-rem(layout.$story-group-gap)",
    "$fill-widths: 62, 48, 74, 36",
    "$hang: min(var(--code-indent, 0) * 1ch, 16ch)",
    "$row-line-height: var(--line-height-reading)",
  ])("passes the Sass variable %s", async (declaration) => {
    expect(await lintSassVariable(declaration)).toEqual([]);
  });

  it("skips a Sass function's locals", async () => {
    const declaration =
      "@function layer($at) {\n  $layer: #{$at} 0 / 1px 2px;\n  @return $layer;\n}";

    expect(await lintSassVariable(declaration)).toEqual([]);
  });

  it("leaves the token owner free to hold raw values", async () => {
    expect(
      await lintCustomProperty("rgb(0 0 0 / 55%)", "./src/styles/probe.scss"),
    ).toEqual([]);
  });
});
