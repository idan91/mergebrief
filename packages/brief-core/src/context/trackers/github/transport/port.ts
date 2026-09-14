import type { Result } from "types/utils";
import { TicketUnreadReasons } from "../../../../types";
import type { ContextReadFailure } from "../../../types";

export interface IssueLocator {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** One issue as the transport saw it; comments are never read. */
export interface IssueRecord {
  readonly title: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly labels: readonly string[];
  readonly milestone: string | null;
  readonly body: string;
  /** The payload carried `pull_request`: a PR, not a ticket. */
  readonly isPullRequest: boolean;
}

/** The port GitHub's read talks through. A root binds one of `GitHubTransports`. */
export interface GitHubTransport {
  readIssue(
    locator: IssueLocator,
    signal: AbortSignal,
  ): Promise<Result<IssueRecord, ContextReadFailure>>;
}

/** HTTP status → unread reason; anything else is a transient "no answer". */
export function readFailureForStatus(
  status: number,
  detail = `HTTP ${status}`,
): ContextReadFailure {
  if (status === 404) return { reason: TicketUnreadReasons.NOT_FOUND, detail };
  if (status === 401 || status === 403) {
    return { reason: TicketUnreadReasons.NO_CREDENTIAL, detail };
  }
  if (status === 429) {
    return { reason: TicketUnreadReasons.RATE_LIMITED, detail };
  }
  return { reason: TicketUnreadReasons.TIMEOUT, detail };
}
