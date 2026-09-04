import { describe, expect, it } from "vitest";
import { TicketTrackers } from "../../src/context/tracker";
import { TRACKERS, getTracker } from "../../src/context/trackers";

describe("trackers", () => {
  it("lists one module per tracker kind, each answering to its own kind", () => {
    const kinds = TRACKERS.map((tracker) => tracker.kind);
    expect(kinds.toSorted()).toEqual(Object.values(TicketTrackers).toSorted());
    for (const kind of Object.values(TicketTrackers)) {
      expect(getTracker(kind).kind).toBe(kind);
    }
  });

  it("builds a read only for a root that offers what the tracker needs", () => {
    const bare = { env: {} };
    expect(getTracker("github").createRead(bare).ok).toBe(false);
    expect(getTracker("notion").createRead(bare).ok).toBe(false);
    const withGh = {
      env: {},
      github: {
        issueReader: {
          readIssue: async () => ({
            ok: false as const,
            error: { reason: "not-found" as const, detail: "stub" },
          }),
        },
      },
    };
    const read = getTracker("github").createRead(withGh);
    expect(read.ok && read.value.kind).toBe("github");
  });

  it("each tracker canonicalizes only its own URLs", () => {
    const issue = "https://github.com/o/r/issues/9/";
    const page = "https://www.notion.so/Page-0123456789abcdef0123456789abcdef";
    expect(getTracker("github").canonicalizeUrl(issue)).toBe(
      "https://github.com/o/r/issues/9",
    );
    expect(getTracker("github").canonicalizeUrl(page)).toBeUndefined();
    expect(getTracker("notion").canonicalizeUrl(page)).toBe(
      "https://www.notion.so/0123456789abcdef0123456789abcdef",
    );
    expect(getTracker("notion").canonicalizeUrl(issue)).toBeUndefined();
  });
});
