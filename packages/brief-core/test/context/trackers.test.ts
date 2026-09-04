import { describe, expect, it } from "vitest";
import { TicketTrackers } from "../../src/context/tracker";
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

  it("every tracker builds its read from the shared deps plus its own slot", () => {
    const bare = { env: {}, contextSources: [] };
    expect(getTracker("github").createRead(bare, undefined).ok).toBe(false);
    expect(getTracker("notion").createRead(bare, undefined).ok).toBe(false);

    const github = getTracker("github").createRead(bare, GITHUB_STUB);
    expect(github.ok && github.value.kind).toBe("github");

    const listsNotion = {
      env: { NOTION_TOKEN: "ntn_x" },
      contextSources: [{ type: "notion" as const }],
    };
    const notion = getTracker("notion").createRead(
      listsNotion,
      NotionTransports.HTTP.create(),
    );
    expect(notion.ok && notion.value.kind).toBe("notion");
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
    const both = resolveTrackerReads(undefined, root);
    expect(both.ok && Object.keys(both.value).toSorted()).toEqual([
      "github",
      "notion",
    ]);

    const noSlots = { ...root, transports: {} };
    expect(resolveTrackerReads(undefined, noSlots)).toEqual({
      ok: true,
      value: {},
    });
    expect(resolveTrackerReads(notionBlock, noSlots)).toEqual({
      ok: true,
      value: {},
    });
  });

  it("a bound slot that cannot build is not a read unless it is the repo's tracker", () => {
    const noToken = {
      env: {},
      contextSources: [],
      transports: {
        github: GITHUB_STUB,
        notion: NotionTransports.HTTP.create(),
      },
    };
    const github = resolveTrackerReads(undefined, noToken);
    expect(github.ok && Object.keys(github.value)).toEqual(["github"]);
    const notionBlock = {
      kind: "notion" as const,
      keyPrefix: "BRIEF",
      databaseId: "a".repeat(32),
    };
    expect(resolveTrackerReads(notionBlock, noToken).ok).toBe(false);
  });
});
