import type { TrackerConfig } from "generators/trackers";

/** A repository's Jira entry listing one project, for the CLI suites. */
export const JIRA_TRACKER: TrackerConfig = {
  kind: "jira",
  projectKeys: ["ACME"],
};
