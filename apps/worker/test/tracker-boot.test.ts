import type { SharedRootDeps } from "brief-core";
import type { TrackerConfig } from "generators/trackers";
import { describe, expect, it } from "vitest";
import { checkTrackerBoot } from "../src/tracker-boot";
import { captureLogger } from "./generate/helpers";
import {
  JIRA_EMAIL,
  JIRA_ROOT,
  JIRA_SITE,
  JIRA_TOKEN,
  JIRA_TRACKER,
  NO_SUCH_SITE,
  PASSED,
  stubJiraTransport,
  type JiraStubAnswers,
} from "./helpers";

interface BootRun {
  readonly boot: Awaited<ReturnType<typeof checkTrackerBoot>>;
  readonly lookups: string[];
}

async function runBoot(
  root: SharedRootDeps,
  answers?: JiraStubAnswers,
): Promise<BootRun> {
  const { transport, lookups } = stubJiraTransport(answers);
  const boot = await checkTrackerBoot(root, {
    jiraTransport: transport,
    log: captureLogger().logger,
  });
  return { boot, lookups };
}

describe("checkTrackerBoot", () => {
  it("passes a config that lists no tracker without a call", async () => {
    const { boot, lookups } = await runBoot({ env: {}, contextSources: [] });

    expect(boot).toEqual(PASSED);
    expect(lookups).toEqual([]);
  });

  it("passes a readable Jira source once its site answers", async () => {
    const { boot, lookups } = await runBoot({
      ...JIRA_ROOT,
      trackers: [JIRA_TRACKER],
    });

    expect(boot).toEqual(PASSED);
    expect(lookups).toEqual([JIRA_SITE]);
  });

  it.each([
    [
      "email",
      { JIRA_API_TOKEN: JIRA_TOKEN },
      "JIRA_EMAIL: jira account email env var is not set",
    ],
    [
      "token",
      { JIRA_EMAIL },
      "JIRA_API_TOKEN: jira API token env var is not set",
    ],
  ])(
    "refuses a listed Jira source whose %s variable is unset",
    async (_label, env, issue) => {
      const { boot, lookups } = await runBoot({ ...JIRA_ROOT, env });

      expect(boot).toEqual({
        ok: false,
        error: `worker composition: invalid tracker configuration — ${issue}`,
      });
      expect(lookups).toEqual([]);
    },
  );

  it.each<[string, TrackerConfig]>([
    ["jira", JIRA_TRACKER],
    [
      "notion",
      { kind: "notion", keyPrefix: "BRIEF", databaseId: "a".repeat(32) },
    ],
  ])(
    "refuses a default %s board the config lists no source for",
    async (kind, tracker) => {
      const { boot, lookups } = await runBoot({
        env: {},
        contextSources: [],
        trackers: [tracker],
      });

      expect(boot).toEqual({
        ok: false,
        error: `worker composition: trackers — ${kind}: no \`contextSources\` entry of type ${kind} on this deployment`,
      });
      expect(lookups).toEqual([]);
    },
  );

  it("refuses a Jira host with no site as a config error", async () => {
    const { boot } = await runBoot(JIRA_ROOT, { cloudId: NO_SUCH_SITE });

    expect(boot).toEqual({
      ok: false,
      error:
        "worker composition: invalid tracker configuration — jira: no Jira site answers at `site` acme.atlassian.net, check the `contextSources` entry of type jira",
    });
  });
});
