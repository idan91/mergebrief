import { describe, expect, it } from "vitest";

import { RowSignalKinds } from "./types";
import { readGenerationSignal, readStatusSignal } from "./utils";

describe("readStatusSignal", () => {
  it("merged and closed outrank the draft flag; open prints only draft", () => {
    expect(readStatusSignal("merged", true)?.kind).toBe(RowSignalKinds.MERGED);
    expect(readStatusSignal("closed", true)?.kind).toBe(RowSignalKinds.CLOSED);
    expect(readStatusSignal("open", true)?.kind).toBe(RowSignalKinds.DRAFT);
    expect(readStatusSignal("open", false)).toBeNull();
  });

  it("prints nothing for a state this bundle predates, draft aside", () => {
    expect(readStatusSignal("unknown", false)).toBeNull();
    expect(readStatusSignal("unknown", true)?.kind).toBe(RowSignalKinds.DRAFT);
  });
});

describe("readGenerationSignal", () => {
  it("prints a brief on its way or one that stopped, never a finished one", () => {
    const at = "2026-09-20T10:00:00Z";

    expect(
      readGenerationSignal({ status: "pending", updatedAt: at })?.kind,
    ).toBe(RowSignalKinds.QUEUED);
    expect(
      readGenerationSignal({ status: "running", updatedAt: at })?.kind,
    ).toBe(RowSignalKinds.RUNNING);
    expect(
      readGenerationSignal({ status: "failed", updatedAt: at })?.kind,
    ).toBe(RowSignalKinds.FAILED);
    expect(
      readGenerationSignal({ status: "capped", updatedAt: at })?.kind,
    ).toBe(RowSignalKinds.CAPPED);
    expect(
      readGenerationSignal({ status: "succeeded", updatedAt: at }),
    ).toBeNull();
    expect(readGenerationSignal(undefined)).toBeNull();
  });

  it("prints nothing for a status this bundle predates", () => {
    expect(
      readGenerationSignal({ status: "unknown", updatedAt: "2026-09-20" }),
    ).toBeNull();
  });
});
