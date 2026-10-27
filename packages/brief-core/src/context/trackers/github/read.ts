import { TicketTrackers, type Result } from "types";
import { TicketUnreadReasons } from "../../../types";
import type { ConfigError } from "generators";
import {
  ContextProviderTypes,
  MAX_SNIPPET_CHARS,
  type ContextProviderDeps,
  type ContextReadFailure,
  type PrimarySnippet,
} from "../../types";
import { isPathSegment } from "../../../github/pr-url";
import { refuseTrackerRead } from "../refusal";
import type { PrimaryRead, SharedRootDeps, TicketReference } from "../types";
import type { GitHubTransport, IssueLocator, IssueRecord } from "./transport";

const ISSUE_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)$/;

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
  if (match === null) {
    return undefined;
  }
  const [, owner = "", repo = "", number = ""] = match;
  if (!isPathSegment(owner) || !isPathSegment(repo)) {
    return undefined;
  }
  return { owner, repo, number: Number(number) };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readPrimaryIssue(
  transport: GitHubTransport,
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
    read = await transport.readIssue(locator, deps.signal);
  } catch (error) {
    if (!deps.signal.aborted && !isAbortError(error)) {
      throw error;
    }
    return {
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT, detail: "read aborted" },
    };
  }
  if (!read.ok) {
    return read;
  }

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

/** GitHub's read for one root: no slot, no read. */
export function createGitHubRead(
  shared: SharedRootDeps,
  transport: GitHubTransport | undefined,
): Result<PrimaryRead, ConfigError> {
  if (transport === undefined) {
    return refuseTrackerRead(["github: no transport bound at this root"]);
  }

  return {
    ok: true,
    value: {
      kind: TicketTrackers.GITHUB,
      readPrimary: (reference, deps) =>
        readPrimaryIssue(transport, reference, deps),
    },
  };
}
