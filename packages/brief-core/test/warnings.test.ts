import { GeneratorWarningKinds } from "generators";
import { describe, expect, it } from "vitest";
import {
  createWarningCollector,
  formatGenerationWarnings,
} from "../src/generation/warnings";
import { GenerationWarningKinds } from "../src/generation/warnings/types";

describe("createWarningCollector", () => {
  it("keeps a rejected usage option out of the stored warnings", () => {
    const collector = createWarningCollector(() => undefined);

    collector.recordGeneratorWarning({
      kind: GeneratorWarningKinds.USAGE_REJECTED,
      message: "warning: model rejected stream_options",
    });
    collector.recordGeneratorWarning({
      kind: GeneratorWarningKinds.EFFORT_REJECTED,
      message: "warning: model rejected reasoning_effort",
    });

    const kinds = collector.listWarnings().map((warning) => warning.kind);
    expect(kinds).toEqual([GeneratorWarningKinds.EFFORT_REJECTED]);
  });
});

describe("formatGenerationWarnings", () => {
  it("puts each validation issue on its own line under the check header", () => {
    const lines = formatGenerationWarnings([
      {
        kind: GenerationWarningKinds.VALIDATION,
        check: "loc coverage",
        issues: ["first issue", "second issue", "third issue"],
      },
    ]);

    expect(lines).toEqual([
      "⚠ loc coverage issues:\nfirst issue\nsecond issue\nthird issue",
    ]);
  });

  it("passes a non-validation warning's message through", () => {
    const lines = formatGenerationWarnings([
      {
        kind: GenerationWarningKinds.REPO_INSTRUCTIONS_OMITTED,
        message: "repo instructions omitted",
      },
    ]);

    expect(lines).toEqual(["repo instructions omitted"]);
  });
});
