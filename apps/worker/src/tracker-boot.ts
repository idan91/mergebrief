import {
  checkConfiguredTrackerReads,
  NotionTransports,
  resolveTrackerReads,
  type JiraTransport,
  type SharedRootDeps,
  type TrackerRootDeps,
} from "brief-core";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import { checkJiraAccess } from "./jira-access";

export interface TrackerBootDeps {
  readonly jiraTransport: JiraTransport;
  readonly log: Logger;
}

function refuseBoot(
  subject: string,
  issues: readonly string[],
): { ok: false; error: string } {
  return {
    ok: false,
    error: `worker composition: ${subject} — ${issues.join("; ")}`,
  };
}

/**
 * What the tracker config must pass before the worker takes jobs; the error
 * is a config error's exit message. Every `contextSources:` entry builds its
 * read, tokens by env-var NAME, and so does every default board, or each job
 * on a repo without its own settings would warn instead of read. A listed
 * Jira site is then asked for.
 */
export async function checkTrackerBoot(
  root: SharedRootDeps,
  deps: TrackerBootDeps,
): Promise<Result<void, string>> {
  const { jiraTransport, log } = deps;
  const bootRoot: TrackerRootDeps = {
    ...root,
    transports: { notion: NotionTransports.HTTP.create(), jira: jiraTransport },
  };

  const listed = checkConfiguredTrackerReads(bootRoot);
  if (!listed.ok) {
    return refuseBoot("invalid tracker configuration", listed.error.issues);
  }
  const defaultBoards = resolveTrackerReads(root.trackers ?? [], bootRoot);
  if (!defaultBoards.ok) {
    return refuseBoot("trackers", defaultBoards.error.issues);
  }

  const jiraAccess = await checkJiraAccess(root, {
    transport: jiraTransport,
    log,
  });
  if (!jiraAccess.ok) {
    return refuseBoot("invalid tracker configuration", [jiraAccess.error]);
  }
  return { ok: true, value: undefined };
}
