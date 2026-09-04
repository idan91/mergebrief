import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CONTEXT_PROVIDER_TYPES,
  CONTEXT_REGISTRY,
  createBuiltInContextProviders,
} from "../../src/context/registry";
import { ContextProviderTypes } from "../../src/context/types";

describe("the generic source registry", () => {
  it("runs the URL chaser as the one built-in source", () => {
    expect(createBuiltInContextProviders().map((p) => p.providerId)).toEqual([
      ContextProviderTypes.URL,
    ]);
    expect(BUILT_IN_CONTEXT_PROVIDER_TYPES).toEqual([ContextProviderTypes.URL]);
  });

  it("holds no tracker: those live in trackers/", () => {
    expect(Object.keys(CONTEXT_REGISTRY)).toEqual([ContextProviderTypes.URL]);
  });

  it("takes no options beyond the type token for the chaser", () => {
    const entry = CONTEXT_REGISTRY[ContextProviderTypes.URL];
    expect(
      entry.options.safeParse({ type: ContextProviderTypes.URL }).success,
    ).toBe(true);
    expect(
      entry.options.safeParse({ type: ContextProviderTypes.URL, token: "x" })
        .success,
    ).toBe(false);
    expect(entry.create({ type: ContextProviderTypes.URL }).ok).toBe(true);
  });
});
