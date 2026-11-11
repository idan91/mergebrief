import { fileURLToPath } from "node:url";

import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

const CONFIG_FILE = fileURLToPath(
  new URL("./.stylelintrc.json", import.meta.url),
);
const VALUE_RULE = "declaration-property-value-allowed-list";
const HOLDER_RULE = "declaration-property-value-disallowed-list";
const DURATION_RULES = new Set([VALUE_RULE, HOLDER_RULE]);

async function lintDurationRules(code: string): Promise<string[]> {
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
  return rules.filter((rule) => DURATION_RULES.has(rule));
}

describe("motion durations in a module", () => {
  it("flags a time literal held in a custom property", async () => {
    expect(await lintDurationRules(".a {\n  --dur: 300ms;\n}\n")).toEqual([
      HOLDER_RULE,
    ]);
  });

  it("flags a time literal held in a Sass variable", async () => {
    expect(await lintDurationRules("$dur: 0.2s;\n")).toEqual([HOLDER_RULE]);
  });

  it("flags a file-local Sass variable read as a duration", async () => {
    const code =
      ".a {\n  transition: opacity $dur;\n  animation-delay: #{$dur};\n}\n";

    expect(await lintDurationRules(code)).toEqual([VALUE_RULE, VALUE_RULE]);
  });

  it("passes a motion token routed through a custom property", async () => {
    const code =
      ".a {\n  --dur: var(--motion-fast);\n\n  transition: opacity var(--dur) motion.$ease;\n}\n";

    expect(await lintDurationRules(code)).toEqual([]);
  });
});
