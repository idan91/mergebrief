// The other half of the curation pin. `briefHandlers.server.test`
// drives REAL failures, which `brief.server` already reduces to curated
// copy, so it cannot tell whether the outer wrapper is still there. This
// file forces the readers to throw a RAW Node-shaped error (the exact
// disclosure the convention exists to stop) and asserts the handler still
// rejects with curated copy. Delete a `curated()` wrapper and this fails.
import { describe, expect, it, vi } from "vitest";

import { isCuratedBriefError } from "../utils/briefErrors";

const RAW_MESSAGE =
  "ENOENT: no such file or directory, open '/srv/app/tools/categorizer/out/x.brief.json'";

function throwRaw(): never {
  throw Object.assign(new Error(RAW_MESSAGE), { code: "ENOENT" });
}

vi.mock("./brief.server", () => ({
  listLocalBriefs: throwRaw,
  readComparisonMarks: throwRaw,
  readLocalBrief: throwRaw,
  readLocalFileDiffs: throwRaw,
  readRevisionChanges: throwRaw,
  readRevisionNarrative: throwRaw,
}));

const { briefHandlers } = await import("./briefHandlers.server");

const CALLS: Record<string, () => Promise<unknown>> = {
  getLocalBrief: () => briefHandlers.getLocalBrief("id_1_deadbeef"),
  getLocalBriefs: () => briefHandlers.getLocalBriefs(),
  getLocalBriefDiffs: () => briefHandlers.getLocalBriefDiffs("id_1_deadbeef"),
  getLocalRevisionChanges: () =>
    briefHandlers.getLocalRevisionChanges("id_1_deadbeef"),
  getLocalComparisonMarks: () =>
    briefHandlers.getLocalComparisonMarks("id_1_deadbeef"),
  getLocalRevisionNarrative: () =>
    briefHandlers.getLocalRevisionNarrative("id_1_deadbeef"),
};

describe("a raw reader failure never escapes a handler", () => {
  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name} replaces it with curated copy`, async () => {
      const message = await call().then(
        () => {
          throw new Error(`${name} resolved; expected a rejection`);
        },
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
      expect(message).not.toBe(RAW_MESSAGE);
      expect(message).not.toContain("ENOENT");
      expect(message).not.toContain("/srv/app");
      expect(isCuratedBriefError(message)).toBe(true);
    });
  }

  it("covers every handler; a new one without a case fails here", () => {
    expect(Object.keys(CALLS).toSorted()).toEqual(
      Object.keys(briefHandlers).toSorted(),
    );
  });
});
