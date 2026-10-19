import { GeneratorWarningKinds } from "generators";
import { describe, expect, it } from "vitest";
import { createWarningCollector } from "../src/generation/warnings";

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
