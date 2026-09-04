import { TicketTrackers } from "../../tracker";
import type { Tracker } from "../types";
import { createGitHubRead } from "./issue-read";
import { canonicalizeGitHubUrl, collectGitHubReferences } from "./references";

/** The GitHub tracker: `#N` syntax from `references.ts`, the issue read from `issue-read.ts`. */
export const githubTracker: Tracker = {
  kind: TicketTrackers.GITHUB,
  collectReferences: collectGitHubReferences,
  canonicalizeUrl: canonicalizeGitHubUrl,
  createRead: createGitHubRead,
};

export {
  createGitHubRead,
  readFailureForStatus,
  renderIssueHeader,
  type IssueLocator,
  type IssueReader,
  type IssueRecord,
} from "./issue-read";
