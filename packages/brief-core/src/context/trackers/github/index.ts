import { TicketTrackers } from "types/trackers";
import type { Tracker } from "../types";
import { createGitHubRead } from "./read";
import { canonicalizeGitHubUrl, collectGitHubReferences } from "./references";

/** The GitHub tracker: syntax from `references.ts`, the port and its implementations from `transport.ts`, the read from `read.ts`. */
export const githubTracker: Tracker<typeof TicketTrackers.GITHUB> = {
  kind: TicketTrackers.GITHUB,
  collectReferences: collectGitHubReferences,
  canonicalizeUrl: canonicalizeGitHubUrl,
  createRead: createGitHubRead,
};

export { createGitHubRead, renderIssueHeader } from "./read";
export {
  GitHubTransports,
  createGhTransport,
  createInstallationTransport,
  readFailureForStatus,
  type GhExec,
  type GitHubTransport,
  type InstallationBounds,
  type InstallationIssueApi,
  type IssueLocator,
  type IssueRecord,
} from "./transport";
