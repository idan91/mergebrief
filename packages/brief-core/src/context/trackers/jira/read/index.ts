import { TicketTrackers, type Result } from "types";
import {
  DEFAULT_JIRA_EMAIL_ENV,
  DEFAULT_JIRA_TOKEN_ENV,
  type ConfigError,
} from "generators";
import { TicketUnreadReasons } from "../../../../types";
import {
  ContextProviderTypes,
  MAX_SNIPPET_CHARS,
  type ContextProviderDeps,
  type PrimarySnippet,
} from "../../../types";
import { truncateToCodeUnits } from "../../../utils";
import { failRead, type ReadResult } from "../../read-failure";
import { refuseTrackerRead } from "../../refusal";
import { resolveCredentialByName } from "../../tokens";
import type { PrimaryRead, SharedRootDeps, TicketReference } from "../../types";
import { buildIssueUrl, parseTicketKey } from "../references";
import type { JiraIssue, JiraReadFailure, JiraTransport } from "../transport";
import { renderDescription } from "./description";

const HEADER_SEPARATOR = " · ";
const LABEL_SEPARATOR = ", ";
const BODY_PART_SEPARATOR = "\n\n";

/** The site a root's `type: jira` entry names and the credential it reads that site with. */
export interface JiraAccount {
  /** The `.atlassian.net` host of the `type: jira` entry. */
  readonly site: string;
  readonly email: string;
  readonly token: string;
}

interface JiraClient extends JiraAccount {
  readonly transport: JiraTransport;
}

/** An issue the repository lists: the key Jira answered under, its URL, and the listed projects its parent is checked against. */
interface ListedIssue {
  readonly key: string;
  readonly source: string;
  readonly projectKeys: readonly string[];
}

/** `summary · status · type · priority · assignee · labels · key`, a piece the issue lacks left out. */
function buildHeader(issue: JiraIssue, key: string): string {
  const pieces = [
    issue.summary.trim(),
    issue.status,
    issue.issueType,
    issue.priority ?? "",
    issue.assigneeName ?? "",
    issue.labels.join(LABEL_SEPARATOR),
    key,
  ];
  return pieces.filter((piece) => piece !== "").join(HEADER_SEPARATOR);
}

/**
 * `Parent: KEY summary` for a parent in a listed project. A parent in any
 * other project is not this repository's, so nothing of it is passed on.
 */
function buildParentLine(
  issue: JiraIssue,
  projectKeys: readonly string[],
): string {
  const { parent } = issue;
  if (parent === undefined) {
    return "";
  }
  const parentKey = parseTicketKey(parent.key);
  if (parentKey === undefined) {
    return "";
  }
  const isListedParent = projectKeys.includes(parentKey.projectKey);
  if (!isListedParent) {
    return "";
  }
  return `Parent: ${parentKey.key} ${parent.summary.trim()}`;
}

/** The parent line when there is one, a blank line, then the description, all inside the snippet cap. */
function buildBody(parentLine: string, description: string): string {
  const parts = [parentLine, description].filter((part) => part !== "");
  const body = parts.join(BODY_PART_SEPARATOR);
  return truncateToCodeUnits(body, MAX_SNIPPET_CHARS);
}

/**
 * The key Jira answered under decides, never the key asked for: Jira answers
 * a request for a moved issue with the issue under its new key. Outside the
 * listed projects the issue is not this repository's.
 */
function resolveListedKey(
  returnedKey: string,
  projectKeys: readonly string[],
): ReadResult<string> {
  const returned = parseTicketKey(returnedKey);
  if (returned === undefined) {
    return failRead(
      TicketUnreadReasons.NOT_FOUND,
      "jira answered under a key that is not an issue key",
    );
  }
  if (!projectKeys.includes(returned.projectKey)) {
    return failRead(
      TicketUnreadReasons.NOT_FOUND,
      "the issue now sits in a project this repository does not list",
    );
  }
  return { ok: true, value: returned.key };
}

/** One call under one budget: the transport's own, or the fan-out's signal when that aborts first. */
async function readIssueWithinBudget(
  client: JiraClient,
  key: string,
  signal: AbortSignal,
): Promise<Result<JiraIssue, JiraReadFailure>> {
  const { transport, site, email, token } = client;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, transport.timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) {
    abort();
  }

  try {
    const session = { site, email, token, signal: controller.signal };
    return await transport.readIssue(session, key);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/** A transport failure with its reason and detail; a cloud id that names no site is logged once. */
function passOnFailure(
  failure: JiraReadFailure,
  client: JiraClient,
  deps: ContextProviderDeps,
): ReadResult<never> {
  if (failure.unknownCloudId === true) {
    deps.log(
      `jira: the cloud id remembered for ${client.site} no longer names a site; the next read looks it up again`,
    );
  }
  return failRead(failure.reason, failure.detail);
}

/** The snippet of an issue the repository lists; the node types its description walk had no rule for are logged by name alone. */
function shapeSnippet(
  issue: JiraIssue,
  listed: ListedIssue,
  reference: TicketReference,
  deps: ContextProviderDeps,
): PrimarySnippet {
  const { key, source, projectKeys } = listed;
  const description = renderDescription(issue.description, MAX_SNIPPET_CHARS);
  if (description.unknownTypes.length > 0) {
    const names = description.unknownTypes.join(", ");
    deps.log(
      `jira: ${key} description holds node types this read has no rule for: ${names}`,
    );
  }

  return {
    providerId: ContextProviderTypes.JIRA,
    source,
    text: buildBody(buildParentLine(issue, projectKeys), description.text),
    tracker: TicketTrackers.JIRA,
    key,
    title: issue.summary.trim(),
    header: buildHeader(issue, key),
    foundIn: reference.foundIn,
  };
}

/** One issue read; a reference that carries no listed project fails closed before any call, and nothing of an unlisted issue is passed on. */
async function readJiraPrimary(
  client: JiraClient,
  reference: TicketReference,
  deps: ContextProviderDeps,
): Promise<ReadResult<PrimarySnippet>> {
  const projectKeys = reference.projectKeys ?? [];
  if (projectKeys.length === 0) {
    return failRead(
      TicketUnreadReasons.NOT_FOUND,
      "the reference carries no listed jira project",
    );
  }

  const read = await readIssueWithinBudget(client, reference.key, deps.signal);
  if (!read.ok) {
    return passOnFailure(read.error, client, deps);
  }
  const key = resolveListedKey(read.value.key, projectKeys);
  if (!key.ok) {
    return key;
  }

  const listed: ListedIssue = {
    key: key.value,
    source: buildIssueUrl(client.site, key.value),
    projectKeys,
  };
  return {
    ok: true,
    value: shapeSnippet(read.value, listed, reference, deps),
  };
}

/**
 * A root's Jira account, each variable by NAME: `undefined` when the config
 * lists no `type: jira` entry, a refusal naming the variable that is unset.
 */
export function resolveJiraAccount(
  shared: SharedRootDeps,
): Result<JiraAccount | undefined, ConfigError> {
  const entry = shared.contextSources.find(
    (source) => source.type === ContextProviderTypes.JIRA,
  );
  if (entry === undefined) {
    return { ok: true, value: undefined };
  }
  const email = resolveCredentialByName(shared.env, {
    owner: "jira",
    field: "emailEnv",
    name: entry.emailEnv ?? DEFAULT_JIRA_EMAIL_ENV,
    holds: "account email",
  });
  if (!email.ok) {
    return email;
  }
  const token = resolveCredentialByName(shared.env, {
    owner: "jira",
    field: "tokenEnv",
    name: entry.tokenEnv ?? DEFAULT_JIRA_TOKEN_ENV,
    holds: "API token",
  });
  if (!token.ok) {
    return token;
  }

  return {
    ok: true,
    value: { site: entry.site, email: email.value, token: token.value },
  };
}

/** Jira's read for one root: the account its `contextSources` entry names, over the root's transport. */
export function createJiraRead(
  shared: SharedRootDeps,
  transport: JiraTransport | undefined,
): Result<PrimaryRead, ConfigError> {
  if (transport === undefined) {
    return refuseTrackerRead(["jira: no transport bound at this root"]);
  }
  const account = resolveJiraAccount(shared);
  if (!account.ok) {
    return account;
  }
  if (account.value === undefined) {
    return refuseTrackerRead([
      "jira: no `contextSources` entry of type jira on this deployment",
    ]);
  }

  const client: JiraClient = { transport, ...account.value };
  return {
    ok: true,
    value: {
      kind: TicketTrackers.JIRA,
      readPrimary: (reference, deps) =>
        readJiraPrimary(client, reference, deps),
    },
  };
}
