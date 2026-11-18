import { describe, expect, it } from "vitest";
import { GenerationFailureClasses } from "types";

import { isRerunHopeless, readFailureClass } from "./failure-class";

describe("readFailureClass", () => {
  it("reads a code this bundle does not know as transient", () => {
    expect(readFailureClass(undefined)).toBe(
      GenerationFailureClasses.TRANSIENT,
    );
  });
});

describe("isRerunHopeless", () => {
  it.each(["diff-too-large", "output-secret", "provider-refusal"] as const)(
    "calls a head that failed as %s hopeless",
    (errorCode) => {
      expect(isRerunHopeless({ status: "failed", errorCode })).toBe(true);
    },
  );

  it.each(["provider-timeout", "provider-auth"] as const)(
    "keeps a rerun open after a %s failure",
    (errorCode) => {
      expect(isRerunHopeless({ status: "failed", errorCode })).toBe(false);
    },
  );

  it("keeps a rerun open for a failure with no code or no failure", () => {
    expect(isRerunHopeless({ status: "failed" })).toBe(false);
    expect(isRerunHopeless({ status: "succeeded" })).toBe(false);
    expect(isRerunHopeless(undefined)).toBe(false);
  });
});
