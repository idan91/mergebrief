import { fileURLToPath } from "node:url";

import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

const CONFIG_FILE = fileURLToPath(
  new URL("./.stylelintrc.json", import.meta.url),
);
const RULE = "house/hover-in-mixin";

async function lintHoverRule(code: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    code,
    codeFilename: fileURLToPath(
      new URL("./src/probe.module.scss", import.meta.url),
    ),
    configFile: CONFIG_FILE,
  });
  const rules = results.flatMap((result) =>
    result.warnings.map((warning) => warning.rule),
  );
  return rules.filter((rule) => rule === RULE);
}

describe("house/hover-in-mixin", () => {
  it("flags a :hover outside the hover mixin", async () => {
    expect(
      await lintHoverRule(".row {\n  &:hover {\n    opacity: 1;\n  }\n}\n"),
    ).toEqual([RULE]);
  });

  it("passes a :hover inside the hover mixin", async () => {
    const code =
      '@use "mixins";\n\n.row {\n  @include mixins.hover {\n    &:hover {\n      opacity: 1;\n    }\n  }\n}\n';

    expect(await lintHoverRule(code)).toEqual([]);
  });

  it("passes a :hover inside a hover-capable media query", async () => {
    const code =
      "@media (hover: hover) {\n  .row:hover {\n    opacity: 1;\n  }\n}\n";

    expect(await lintHoverRule(code)).toEqual([]);
  });

  it("flags a :hover inside a media query that is not about hover", async () => {
    const code =
      "@media (width >= 40rem) {\n  .row:hover {\n    opacity: 1;\n  }\n}\n";

    expect(await lintHoverRule(code)).toEqual([RULE]);
  });
});
