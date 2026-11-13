import type { JiraSite } from "../../src/context/trackers/types";

/** The repository's Jira entry the reference and link suites share. */
export const JIRA_TRACKER = {
  kind: "jira" as const,
  projectKeys: ["ACME", "WEB"],
};

/** The instance's Jira site, with one custom link host. */
export const JIRA_SITE: JiraSite = {
  host: "acme.atlassian.net",
  linkHosts: ["jira.acme.com"],
};

/** The canonical URL of `ACME-12` on that site. */
export const JIRA_ISSUE_URL = "https://acme.atlassian.net/browse/ACME-12";
