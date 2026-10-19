// Parser tests against realistic wire bodies: route tests that seed the query
// cache bypass the parser, so a shape drift would otherwise ship green.
import type { SpendView as WireSpendView } from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";
import type { ReadsWireFields } from "@web/test/wire-fields";

import { spendViewSchema } from "./schemas";
import type { SpendView } from "./types";

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

    expect(parsed.ok && "cap" in parsed.value).toBe(false);
  });

  it("rejects a body without the count", () => {
    const { startedRuns: _startedRuns, ...countless } = WIRE_SPEND;

    expect(parseWithSchema(spendViewSchema, countless).ok).toBe(false);
  });
});

const PINS = {
  matchesInterface: true satisfies Equals<
    z.output<typeof spendViewSchema>,
    SpendView
  >,
  readsOnlyWireFields: true satisfies ReadsWireFields<
    z.output<typeof spendViewSchema>,
    WireSpendView
  >,
} as const;

describe("the spend schema is pinned", () => {
  it.each(Object.entries(PINS))("%s", (_pin, pinned) => {
    expect(pinned).toBe(true);
  });
});
