import { createJiraRead } from "../../../../../src/context/trackers/jira";
import type {
  PrimaryRead,
  SharedRootDeps,
  TicketReference,
} from "../../../../../src/context/trackers/types";
import type { JiraFetch } from "../../../../../src/context/trackers/jira/transport/http";
import type { PrimarySnippet } from "../../../../../src/context/types";
import { JIRA_TRACKER } from "../../../helpers";
import {
  EMAIL,
  SITE,
  TOKEN,
  makeTransport,
  readFixture,
  stubSiteFetch,
  type AnswerSource,
  type FetchCall,
} from "../transport/http/helpers";

type ReadResult = Awaited<ReturnType<PrimaryRead["readPrimary"]>>;

export const SHARED: SharedRootDeps = {
  env: { JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN },
  contextSources: [{ type: "jira", site: SITE }],
};

export interface ReadOutcome {
  readonly result: ReadResult;
  readonly logs: string[];
  readonly calls: FetchCall[];
}

export function makeReference(
  key: string,
  overrides: Partial<TicketReference> = {},
): TicketReference {
  return {
    tracker: "jira",
    key,
    url: `https://${SITE}/browse/${key}`,
    projectKeys: JIRA_TRACKER.projectKeys,
    foundIn: "description",
    closing: false,
    ...overrides,
  };
}

/** The real read over the real HTTP transport, answered by `fetch`. */
export function makeRead(fetch: JiraFetch, timeoutMs?: number): PrimaryRead {
  const read = createJiraRead(SHARED, makeTransport(fetch, timeoutMs));
  if (!read.ok) {
    throw new Error(read.error.issues.join("; "));
  }
  return read.value;
}

/** One read of `reference` against a site whose API answers `api`. */
export async function readThrough(
  api: AnswerSource,
  reference: TicketReference = makeReference("ACME-2"),
  tenantInfo?: AnswerSource,
): Promise<ReadOutcome> {
  const { fetch, calls } = stubSiteFetch(api, tenantInfo);
  const logs: string[] = [];
  const result = await makeRead(fetch).readPrimary(reference, {
    log: (message) => logs.push(message),
    signal: new AbortController().signal,
  });
  return { result, logs, calls };
}

/** One read answered by a recorded issue. */
export function readRecorded(
  fixtureName: string,
  reference?: TicketReference,
): Promise<ReadOutcome> {
  return readThrough(
    { status: 200, body: readFixture(fixtureName) },
    reference,
  );
}

/** A recorded issue with `fields` edited, as the body Jira would send. */
export function makeIssueBody(
  fixtureName: string,
  edit: (fields: Record<string, unknown>) => void,
  key?: string,
): string {
  const issue = JSON.parse(readFixture(fixtureName)) as {
    key: string;
    fields: Record<string, unknown>;
  };
  edit(issue.fields);
  return JSON.stringify({ ...issue, key: key ?? issue.key });
}

/** The snippet of a read that must have succeeded. */
export function requireSnippet(outcome: ReadOutcome): PrimarySnippet {
  if (!outcome.result.ok) {
    throw new Error(`expected a read, got ${outcome.result.error.detail}`);
  }
  return outcome.result.value;
}
