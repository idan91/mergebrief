import { describe, expect, it } from "vitest";
import { TicketTrackers } from "types/trackers";
import {
  TRACKERS,
  getTracker,
  resolveTrackerReads,
} from "../../src/context/trackers";
import { NotionTransports } from "../../src/context/trackers/notion";

const GITHUB_STUB = {
  readIssue: async () => ({
    ok: false as const,
    error: { reason: "not-found" as const, detail: "stub" },
  }),
};

describe("trackers", () => {
  it("lists one module per tracker kind, each answering to its own kind", () => {
    const kinds = TRACKERS.map((tracker) => tracker.kind);
    expect(kinds.toSorted()).toEqual(Object.values(TicketTrackers).toSorted());
    for (const kind of Object.values(TicketTrackers)) {
      expect(getTracker(kind).kind).toBe(kind);
    }
  });

  it("resolveTrackerReads builds one read per bound slot: no slot, no read", () => {
    const root = {
      env: { NOTION_TOKEN: "ntn_x" },
      contextSources: [{ type: "notion" as const }],
      transports: {
        github: GITHUB_STUB,
        notion: NotionTransports.HTTP.create(),
      },
    };
    const notionBlock = {
      kind: "notion" as const,
      keyPrefix: "BRIEF",
      databaseId: "a".repeat(32),
    };
    const both = resolveTrackerReads([], root);
    expect(both.ok && Object.keys(both.value).toSorted()).toEqual([
      "github",
      "notion",
    ]);

    const noSlots = { ...root, transports: {} };
    expect(resolveTrackerReads([], noSlots)).toEqual({
      ok: true,
      value: {},
    });
    expect(resolveTrackerReads([notionBlock], noSlots)).toEqual({
      ok: true,
      value: {},
    });
  });

  it("skips a bound slot that cannot build unless it is the repo's tracker", () => {
    const noToken = {
      env: {},
      contextSources: [],
      transports: {
        github: GITHUB_STUB,
        notion: NotionTransports.HTTP.create(),
      },
    };
    const github = resolveTrackerReads([], noToken);
    expect(github.ok && Object.keys(github.value)).toEqual(["github"]);
    const notionBlock = {
      kind: "notion" as const,
      keyPrefix: "BRIEF",
      databaseId: "a".repeat(32),
    };
    expect(resolveTrackerReads([notionBlock], noToken).ok).toBe(false);
  });
});
