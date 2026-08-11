// THE PIN for the curation convention: every
// local-brief handler's rejection must be a string this codebase authored.
// Deleting a `curated()` wrapper makes this suite fail — which is the whole
// point, because the failure mode it guards (a Node error's absolute path
// rendered into an unauthenticated page) is invisible in every other gate.
//
// It drives `briefHandlers` rather than the `createServerFn` exports because
// those cannot be invoked without the Start server runtime; the RPC surface
// in `brief.functions.ts` is one-line delegation to exactly these.
import { describe, expect, it } from "vitest";

import { briefHandlers, type BriefHandlers } from "./briefHandlers.server";
import { GenerateErrorCode, isCuratedBriefError } from "../utils/briefErrors";

/**
 * One rejecting call per handler. Ids pass the charset guard but name no
 * artifact; the URL is not a PR URL — the cheapest real failure each has.
 */
const REJECTING_CALLS: Record<keyof BriefHandlers, () => Promise<unknown>> = {
  getLocalBrief: () => briefHandlers.getLocalBrief("../../etc/passwd"),
  // The listing degrades rather than throwing on a missing dir, so this one
  // is driven by an unreadable id through the same boundary.
  getLocalBriefs: () => briefHandlers.getLocalBrief("no-such_1_deadbeef"),
  getLocalRevisionChanges: () =>
    briefHandlers.getLocalRevisionChanges("../../etc/passwd"),
  getLocalComparisonMarks: () =>
    briefHandlers.getLocalComparisonMarks("../../etc/passwd"),
  getLocalRevisionNarrative: () =>
    briefHandlers.getLocalRevisionNarrative("../../etc/passwd"),
  generateBrief: () =>
    briefHandlers.generateBrief("https://example.com/not-a-pr?token=shhh"),
};

describe("every brief handler ends at the curation boundary", () => {
  for (const [name, call] of Object.entries(REJECTING_CALLS)) {
    it(`${name} rejects with curated copy only`, async () => {
      const message = await call().then(
        () => {
          throw new Error(`${name} resolved; expected a rejection`);
        },
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
      expect(isCuratedBriefError(message)).toBe(true);
      // The two disclosure shapes this convention exists to stop.
      expect(message).not.toContain("ENOENT");
      expect(message).not.toContain("/Users/");
      expect(message).not.toContain("passwd");
      expect(message).not.toContain("shhh");
    });
  }

  it("covers every handler — a new one without a case fails here", () => {
    expect(Object.keys(REJECTING_CALLS).toSorted()).toEqual(
      Object.keys(briefHandlers).toSorted(),
    );
  });
});

describe("generateBrief boundary", () => {
  it("passes the deliberate user-facing sentences through unchanged", async () => {
    const message = await briefHandlers
      .generateBrief("https://example.com/nope")
      .catch((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      );
    expect(message).toBe(GenerateErrorCode.NOT_A_PR_URL);
  });
});
