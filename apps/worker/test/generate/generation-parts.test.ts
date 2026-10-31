// The pure pieces of a multi-call run's bookkeeping: the call a fresh part
// completes and the .gitattributes digest a grouping part is reusable under.
import { describe, expect, it } from "vitest";
import {
  digestGitAttributes,
  readCompletedDetailCall,
} from "../../src/task/generate/logic/generation-parts";

describe("readCompletedDetailCall", () => {
  it("completes a call on its whole batch or on the second half of a cut one", () => {
    expect(readCompletedDetailCall("detail:3")).toBe(3);
    expect(readCompletedDetailCall("detail:3:2")).toBe(3);
  });

  it("completes nothing on the grouping part or a cut batch's first half", () => {
    expect(readCompletedDetailCall("grouping")).toBeUndefined();
    expect(readCompletedDetailCall("detail:3:1")).toBeUndefined();
  });
});

describe("digestGitAttributes", () => {
  it("digests an absent file as an empty one and another file apart", () => {
    expect(digestGitAttributes(undefined)).toBe(digestGitAttributes(""));
    expect(digestGitAttributes("*.lock linguist-generated\n")).not.toBe(
      digestGitAttributes(""),
    );
  });
});
