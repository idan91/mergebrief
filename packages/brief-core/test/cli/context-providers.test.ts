import { describe, expect, it } from "vitest";
import {
  createCliContextProviders,
  createCliRootDeps,
  resolveCliTrackerReads,
} from "../../src/cli/context-providers";
import { resolveTrackerReads } from "../../src/context/trackers";
import { ContextProviderTypes } from "../../src/context/types";
import { TicketTrackers } from "../../src/context/tracker";

const NOTION_BLOCK = {
  kind: "notion",
  keyPrefix: "BRIEF",
  databaseId: "a".repeat(32),
} as const;

describe("the CLIs' context root", () => {
  it("runs the URL chaser as its generic source", () => {
    expect(createCliContextProviders().map((p) => p.providerId)).toEqual([
      ContextProviderTypes.URL,
    ]);
  });

  it("offers one transport per tracker, every tracker", () => {
    const root = createCliRootDeps({}, []);
    expect(Object.keys(root.transports).toSorted()).toEqual(
      Object.values(TicketTrackers).toSorted(),
    );
  });

  it("offers GitHub through gh, so a repo with no tracker block reads GitHub", () => {
    const reads = resolveTrackerReads(undefined, createCliRootDeps({}, []));
    expect(reads.ok && Object.keys(reads.value)).toEqual([
      TicketTrackers.GITHUB,
    ]);
  });

  it("reads Notion when the repo names it and the config lists it with a token", () => {
    const reads = resolveTrackerReads(
      NOTION_BLOCK,
      createCliRootDeps({ NOTION_TOKEN: "ntn_x" }, [{ type: "notion" }]),
    );
    expect(reads.ok && Object.keys(reads.value).toSorted()).toEqual([
      TicketTrackers.GITHUB,
      TicketTrackers.NOTION,
    ]);
  });

  it("refuses a Notion repo whose config lists no token, naming the var and never a value", () => {
    const read = resolveTrackerReads(
      NOTION_BLOCK,
      createCliRootDeps({ NOTION_TOKEN: "ntn_should_not_leak" }, [
        { type: "notion", tokenEnv: "MY_NOTION" },
      ]),
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    const text = read.error.issues.join("; ");
    expect(text).toContain("MY_NOTION");
    expect(text).not.toContain("ntn_");
  });

  it("passes the env through by reference for token lookups", () => {
    const env = { NOTION_TOKEN: "ntn_x" };
    expect(createCliRootDeps(env, []).env).toBe(env);
  });

  it("builds no tracker read when --context supplied the ticket, so no credential is required", () => {
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
    const read = resolveCliTrackerReads(supplied, NOTION_BLOCK, root);
    expect(read).toEqual({ ok: true, value: undefined });
    const live = resolveCliTrackerReads(undefined, NOTION_BLOCK, root);
    expect(live.ok).toBe(false);
  });
});
