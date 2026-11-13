import { describe, expect, it } from "vitest";
import {
  createCliRootDeps,
  describeTrackerRefusal,
  resolveCliTrackerReads,
} from "../../src/cli/context-providers";
import { ContextProviderTypes, resolveTrackerReads } from "brief-core";
import { TicketTrackers } from "types/trackers";
import { JIRA_TRACKER } from "./helpers";

const NOTION_BLOCK = {
  kind: "notion",
  keyPrefix: "BRIEF",
  databaseId: "a".repeat(32),
} as const;

const JIRA_SOURCE = { type: "jira", site: "acme.atlassian.net" } as const;
const JIRA_ENV = {
  JIRA_EMAIL: "dana@acme.example",
  JIRA_API_TOKEN: "jira-token",
};

/** What a CLI prints before it exits 1 on a repo whose tracker it cannot read. */
function describeCliRefusal(
  env: Record<string, string>,
  contextSources: Parameters<typeof createCliRootDeps>[1],
): string {
  const root = createCliRootDeps(env, contextSources);
  const reads = resolveCliTrackerReads(undefined, [JIRA_TRACKER], root);
  if (reads.ok) {
    throw new Error("expected a refusal");
  }
  return describeTrackerRefusal(reads.error);
}

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

  it("refuses a repo naming Jira when the config lists no Jira source", () => {
    expect(describeCliRefusal(JIRA_ENV, [])).toBe(
      "jira: no `contextSources` entry of type jira on this deployment — a variable goes in tools/categorizer/.env (see .env.example), a `contextSources` entry in the file --config names.",
    );
  });

  it.each([
    ["JIRA_EMAIL", { JIRA_API_TOKEN: JIRA_ENV.JIRA_API_TOKEN }],
    ["JIRA_API_TOKEN", { JIRA_EMAIL: JIRA_ENV.JIRA_EMAIL }],
  ])("refuses a Jira source with %s unset, naming it", (variable, env) => {
    const refusal = describeCliRefusal(env, [JIRA_SOURCE]);

    expect(refusal).toMatch(new RegExp(`^${variable}: jira .* is not set — `));
    expect(refusal).toContain("tools/categorizer/.env");
    expect(refusal).toContain("--config");
    expect(refusal).not.toContain("dana@acme.example");
    expect(refusal).not.toContain("jira-token");
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
