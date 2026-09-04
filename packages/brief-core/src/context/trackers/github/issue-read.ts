import type { Result } from "types";
import { TicketUnreadReasons } from "../../../types";
import { TicketTrackers } from "../../tracker";
import type { ConfigError } from "generators";
import {
  ContextProviderTypes,
  MAX_SNIPPET_CHARS,
  type ContextProviderDeps,
  type ContextReadFailure,
  type PrimarySnippet,
} from "../../types";
import { refuseTrackerRead } from "../refusal";
import type { PrimaryRead, TicketReference, TrackerRootDeps } from "../types";

export interface IssueLocator {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** One issue as the reader saw it; comments are never read. */
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

/**
 * The port a composition root injects: the worker binds the installation
 * client, the CLIs bind `gh`. Expected refusals come back as `Result`.
 */
export interface IssueReader {
  readIssue(
    locator: IssueLocator,
    signal: AbortSignal,
  ): Promise<Result<IssueRecord, ContextReadFailure>>;
}

const ISSUE_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)$/;

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

/** `state · labels · milestone`, empty pieces omitted. */
export function renderIssueHeader(record: IssueRecord): string {
  const closedWithReason =
    record.state === "closed" && record.stateReason !== null;
  const state = closedWithReason
    ? `${record.state} (${record.stateReason})`
    : record.state;
  const pieces = [state, record.labels.join(", "), record.milestone ?? ""];
  return pieces.filter((piece) => piece !== "").join(" · ");
}

function parseIssueLocator(url: string): IssueLocator | undefined {
  const match = ISSUE_URL.exec(url);
  if (match === null) return undefined;
  const [, owner = "", repo = "", number = ""] = match;
  return { owner, repo, number: Number(number) };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readPrimaryIssue(
  reader: IssueReader,
  reference: TicketReference,
  deps: ContextProviderDeps,
): Promise<Result<PrimarySnippet, ContextReadFailure>> {
  const locator = parseIssueLocator(reference.url);
  if (locator === undefined) {
    return {
      ok: false,
      error: {
        reason: TicketUnreadReasons.UNSUPPORTED,
        detail: "not a GitHub issue URL",
      },
    };
  }

  let read: Result<IssueRecord, ContextReadFailure>;
  try {
    read = await reader.readIssue(locator, deps.signal);
  } catch (error) {
    if (!deps.signal.aborted && !isAbortError(error)) throw error;
    return {
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT, detail: "read aborted" },
    };
  }
  if (!read.ok) return read;

  const record = read.value;
  if (record.isPullRequest) {
    return {
      ok: false,
      error: {
        reason: TicketUnreadReasons.NOT_FOUND,
        detail: `#${locator.number} is a pull request, not an issue`,
        resolvedToPullRequest: true,
      },
    };
  }
  return {
    ok: true,
    value: {
      providerId: ContextProviderTypes.GITHUB_ISSUES,
      source: reference.url,
      text: record.body.slice(0, MAX_SNIPPET_CHARS),
      tracker: TicketTrackers.GITHUB,
      key: "",
      title: record.title,
      header: renderIssueHeader(record),
      foundIn: reference.foundIn,
    },
  };
}

/** GitHub's read for one root: needs the root's issue transport, nothing else. */
export function createGitHubRead(
  root: TrackerRootDeps,
): Result<PrimaryRead, ConfigError> {
  if (root.github === undefined) {
    return refuseTrackerRead(["github: no issue transport bound at this root"]);
  }
  const reader = root.github.issueReader;

  return {
    ok: true,
    value: {
      kind: TicketTrackers.GITHUB,
      readPrimary: (reference, deps) =>
        readPrimaryIssue(reader, reference, deps),
    },
  };
}
