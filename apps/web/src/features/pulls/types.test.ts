import { describe, expect, it } from "vitest";
import type { LastReviewComparisonView, PullStackView } from "contract";
import type { Equals } from "types/utils";
import type { LastReviewComparison } from "./types";
import type { PullStack } from "@web/features/brief/model";

// The contract's `lastReview` union, minus its unavailable branch: the
// payload the FE's `available` branch mirrors field for field.
type SourceAvailableLastReview = Exclude<
  LastReviewComparisonView,
  { readonly unavailable: unknown }
>;
/**
 * The FE re-shapes the wire union into a discriminated one (`kind`) so
 * consumers switch without re-probing keys, so the two unions are NOT
 * identical by design, but the available branch's PAYLOAD must be. `Equals`
 * is exact: it fails on a renamed or retyped field, and unlike mutual
 * assignability it also fails when the OPTIONAL `baselineIndex` half drifts.
 */
const availableBranchPin: Equals<
  Omit<Extract<LastReviewComparison, { kind: "available" }>, "kind">,
  SourceAvailableLastReview
> = true;

/**
 * Same keys, and the same `asOf` type, as the contract's stack read. The
 * `stack` member is the FE's own `PrStack`, mutable like the rest of the
 * brief types, so the pin stops at the key set and the scalar field.
 */
const pullStackKeysPin: Equals<keyof PullStack, keyof PullStackView> = true;
const pullStackAsOfPin: Equals<PullStack["asOf"], PullStackView["asOf"]> = true;
const pullStackPin = pullStackKeysPin && pullStackAsOfPin;

describe("lockstep pin against the wire contract", () => {
  it("the available lastReview branch mirrors the contract payload exactly", () => {
    // Compile-time pin (gated by `pnpm -C apps/web typecheck`, which includes
    // test files); asserted at runtime so it stays visible in the suite.
    expect(availableBranchPin).toBe(true);
  });

  it("the stack read mirrors the contract's PullStackView", () => {
    expect(pullStackPin).toBe(true);
  });
});
