import { describe, expect, it } from "vitest";

import { lintFixture } from "./run-oxlint";

// RuleTester has no disable-directive support, so these run the binary. Each
// pairs with its rule's bad fixture, so an empty list proves the directive.
describe("disable directives on the oxlint binary", () => {
  it("honours a line disable naming house/no-raw-button", () => {
    expect(lintFixture("no-raw-button", "bad.tsx")).not.toEqual([]);
    expect(lintFixture("no-raw-button", "disabled.tsx")).toEqual([]);
  });

  it("honours a line disable naming house/no-re-export", () => {
    expect(lintFixture("no-re-export", "bad.ts")).not.toEqual([]);
    expect(lintFixture("no-re-export", "disabled.ts")).toEqual([]);
  });
});
