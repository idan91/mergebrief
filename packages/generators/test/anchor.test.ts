import { describe, expect, it } from "vitest";
import {
  AnchorSchema,
  AnchorStates,
  FreshRestartReasons,
} from "../src/contract/generation";

/**
 * The anchor origin stamp: every brief records whether it was
 * generated anchored to a previous brief, as a fresh restart (with a reason),
 * or with no anchor at all (first generation).
 */

describe("AnchorSchema", () => {
  it("parses the three states", () => {
    expect(
      AnchorSchema.safeParse({ state: AnchorStates.ANCHORED }).success,
    ).toBe(true);
    expect(AnchorSchema.safeParse({ state: AnchorStates.NONE }).success).toBe(
      true,
    );
    expect(
      AnchorSchema.safeParse({
        state: AnchorStates.FRESH_RESTART,
        reason: FreshRestartReasons.MODEL_SWAP,
      }).success,
    ).toBe(true);
  });

  it("requires a reason on fresh-restart and forbids it elsewhere", () => {
    expect(
      AnchorSchema.safeParse({ state: AnchorStates.FRESH_RESTART }).success,
    ).toBe(false);
    expect(
      AnchorSchema.safeParse({
        state: AnchorStates.ANCHORED,
        reason: FreshRestartReasons.MODEL_SWAP,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown states and unknown reasons", () => {
    expect(AnchorSchema.safeParse({ state: "floating" }).success).toBe(false);
    expect(
      AnchorSchema.safeParse({
        state: AnchorStates.FRESH_RESTART,
        reason: "vibes",
      }).success,
    ).toBe(false);
  });
});
