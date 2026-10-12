// Boundary-guard tests for the read-API PR shapes. The API is trusted
// infrastructure but still an external boundary to this bundle, so responses
// are parsed, never cast.
import { describe, expect, it } from "vitest";
import type { LastReviewComparisonView, PullStackView } from "contract";
import type { Equals } from "types/utils";
import { parsePullStack, type LastReviewComparison } from "./types";
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
});

describe("parsePullStack", () => {
  it("parses a null stack, a chain and a fork", () => {
    expect(parsePullStack({ stack: null })).toEqual({
      ok: true,
      value: { stack: null },
    });
    const chain = {
      members: [
        { number: 6, title: "Bottom" },
        { number: 7, title: "Top" },
      ],
      index: 2,
    };
    expect(parsePullStack({ stack: chain })).toEqual({
      ok: true,
      value: { stack: chain },
    });
    const fork = {
      parent: { number: 6, title: "Bottom" },
      children: [
        { number: 8, title: "Left" },
        { number: 9, title: "Right" },
      ],
    };
    expect(parsePullStack({ stack: fork })).toEqual({
      ok: true,
      value: { stack: fork },
    });
    expect(parsePullStack({ stack: { children: fork.children } })).toEqual({
      ok: true,
      value: { stack: { children: fork.children } },
    });
  });

  it("keeps the recorded read time and refuses an unreadable one", () => {
    const chain = { members: [{ number: 6, title: "x" }], index: 1 };
    const asOf = "2026-09-19T12:00:00.000Z";
    expect(parsePullStack({ stack: chain, asOf })).toEqual({
      ok: true,
      value: { stack: chain, asOf },
    });
    expect(parsePullStack({ stack: chain, asOf: 5 }).ok).toBe(false);
    expect(parsePullStack({ stack: chain, asOf: "garbage" }).ok).toBe(false);
  });

  it("the wire shape mirrors the contract's PullStackView", () => {
    expect(pullStackPin).toBe(true);
  });

  it("refuses a malformed member or a missing index", () => {
    expect(
      parsePullStack({
        stack: { members: [{ number: "6", title: "x" }], index: 1 },
      }).ok,
    ).toBe(false);
    expect(
      parsePullStack({ stack: { members: [{ number: 6, title: "x" }] } }).ok,
    ).toBe(false);
    expect(parsePullStack({ stack: "nope" }).ok).toBe(false);
    expect(parsePullStack([]).ok).toBe(false);
  });
});
