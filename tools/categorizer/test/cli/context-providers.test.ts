import { describe, expect, it } from "vitest";
import {
  createCliRootDeps,
  resolveCliTrackerReads,
} from "../../src/cli/context-providers";
import { ContextProviderTypes, resolveTrackerReads } from "brief-core";
import { TicketTrackers } from "types/trackers";

const NOTION_BLOCK = {
  kind: "notion",
  keyPrefix: "BRIEF",
  databaseId: "a".repeat(32),
} as const;

describe("the CLIs' context root", () => {
  it("offers one transport per tracker, every tracker", () => {
    const root = createCliRootDeps({}, []);
    expect(Object.keys(root.transports).toSorted()).toEqual(
      Object.values(TicketTrackers).toSorted(),
    );
  });

  it("offers GitHub through gh, so a repo with no tracker block reads GitHub", () => {
    const reads = resolveTrackerReads([], createCliRootDeps({}, []));
    expect(reads.ok && Object.keys(reads.value)).toEqual([
      TicketTrackers.GITHUB,
    ]);
  });

  it("reads Notion when the repo names it and the config gives it a token", () => {
    const reads = resolveTrackerReads(
      [NOTION_BLOCK],
      createCliRootDeps({ NOTION_TOKEN: "ntn_x" }, [{ type: "notion" }]),
    );
    expect(reads.ok && Object.keys(reads.value).toSorted()).toEqual([
      TicketTrackers.GITHUB,
      TicketTrackers.NOTION,
    ]);
  });

  it("builds no tracker read and needs no credential under --context", () => {
    const supplied = {
      providerId: ContextProviderTypes.NOTION,
      source: "ticket.json",
      text: "the ticket",
      tracker: TicketTrackers.NOTION,
      key: "BRIEF-1",
      title: "t",
      header: "",
      foundIn: "description" as const,
    };
    const root = createCliRootDeps({}, []);
    const read = resolveCliTrackerReads(supplied, [NOTION_BLOCK], root);
    expect(read).toEqual({ ok: true, value: undefined });
    const live = resolveCliTrackerReads(undefined, [NOTION_BLOCK], root);
    expect(live.ok).toBe(false);
  });
});
