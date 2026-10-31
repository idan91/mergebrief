// Parser tests against realistic wire bodies: route tests that seed the query
// cache bypass the parser, so a shape drift would otherwise ship green.
import type { SpendView } from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";
import type { ReadsWireFields } from "@web/test/wire-fields";

import { spendViewSchema } from "./schemas";

const WIRE_SPEND = {
  startedRuns: 37,
  cap: 50,
  dayStartedAt: "2026-10-19T00:00:00.000Z",
  resetsAt: "2026-10-20T00:00:00.000Z",
};

describe("spendViewSchema", () => {
  it("reads a capped Instance's spend", () => {
    const parsed = parseWithSchema(spendViewSchema, WIRE_SPEND);

    expect(parsed).toEqual({ ok: true, value: WIRE_SPEND });
  });

  it("reads an uncapped Instance without a cap", () => {
    const { cap: _cap, ...uncapped } = WIRE_SPEND;

    const parsed = parseWithSchema(spendViewSchema, uncapped);

    expect(parsed).toEqual({ ok: true, value: uncapped });
  });

  it("reads the day's large runs", () => {
    const withLarge = { ...WIRE_SPEND, largeRuns: { runs: 2, units: 12 } };

    const parsed = parseWithSchema(spendViewSchema, withLarge);

    expect(parsed).toEqual({ ok: true, value: withLarge });
  });

  it("rejects a body without the count", () => {
    const { startedRuns: _startedRuns, ...countless } = WIRE_SPEND;

    expect(parseWithSchema(spendViewSchema, countless).ok).toBe(false);
  });
});

const PINS = {
  matchesWire: true satisfies Equals<
    z.output<typeof spendViewSchema>,
    SpendView
  >,
  readsOnlyWireFields: true satisfies ReadsWireFields<
    z.output<typeof spendViewSchema>,
    SpendView
  >,
} as const;

void PINS;
