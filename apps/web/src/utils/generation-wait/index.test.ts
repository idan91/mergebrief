import { describe, expect, it } from "vitest";

import { deriveGenerationWait } from ".";
import { GenerationWaits } from "./types";

describe("deriveGenerationWait", () => {
  it("reads a pending head whose job spent its attempts as stalled", () => {
    expect(
      deriveGenerationWait({ status: "pending", waitReason: "stalled" }),
    ).toBe(GenerationWaits.STALLED);
  });

  it("reads a running head as in flight", () => {
    expect(deriveGenerationWait({ status: "running" })).toBe(
      GenerationWaits.IN_FLIGHT,
    );
  });

  it("reads a pending head waiting for a slot as in flight", () => {
    expect(
      deriveGenerationWait({
        status: "pending",
        waitReason: "waiting-for-slot",
      }),
    ).toBe(GenerationWaits.IN_FLIGHT);
  });

  it.each(["succeeded", "failed", "capped", "superseded"] as const)(
    "reads a terminal status as settled: %s",
    (status) => {
      expect(deriveGenerationWait({ status })).toBe(GenerationWaits.SETTLED);
    },
  );

  it("reads a status this bundle predates, or none, as settled", () => {
    expect(deriveGenerationWait({ status: "unknown" })).toBe(
      GenerationWaits.SETTLED,
    );
    expect(deriveGenerationWait(undefined)).toBe(GenerationWaits.SETTLED);
  });
});
