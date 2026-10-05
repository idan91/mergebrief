import { describe, expect, it } from "vitest";
import { createBuiltInContextProviders } from "../../src/context/registry";
import { ContextProviderTypes } from "../../src/context/types";

describe("the built-in context providers", () => {
  it("runs the URL chaser as the one built-in source", () => {
    expect(createBuiltInContextProviders().map((p) => p.providerId)).toEqual([
      ContextProviderTypes.URL,
    ]);
  });
});
