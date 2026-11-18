import { describe, expect, it } from "vitest";
import {
  CUSTOM_ATTRIBUTE_NAME_PATTERN,
  INSTRUCTIONS_INJECTION_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES as CAT_PARKED,
  RESERVED_ATTRIBUTE_WORDS as CAT_RESERVED,
} from "brief-core";
import {
  ATTRIBUTE_NAME_PATTERN,
  INSTRUCTIONS_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES,
  RESERVED_ATTRIBUTE_WORDS,
} from "repo-config";

describe("categorizer and repo-config vocabulary lockstep", () => {
  it("shares reserved names, name patterns and instruction budgets", () => {
    expect([...CAT_PARKED]).toEqual([...PARKED_ATTRIBUTE_CANDIDATES]);
    expect([...CAT_RESERVED]).toEqual([...RESERVED_ATTRIBUTE_WORDS]);
    expect(CUSTOM_ATTRIBUTE_NAME_PATTERN.source).toBe(
      ATTRIBUTE_NAME_PATTERN.source,
    );
    expect(INSTRUCTIONS_INJECTION_BUDGET_BYTES).toBe(INSTRUCTIONS_BUDGET_BYTES);
  });
});
