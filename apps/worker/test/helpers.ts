import {
  JiraCloudIdFailureReasons,
  JiraScopeChecks,
  type JiraScopeCheck,
  type JiraTransport,
  type SharedRootDeps,
} from "brief-core";
import type { TrackerConfig } from "generators/trackers";

type CloudIdAnswer = Awaited<ReturnType<JiraTransport["readCloudId"]>>;
type JiraSession = Parameters<JiraTransport["checkTokenScope"]>[0];

export const JIRA_SITE = "acme.atlassian.net";
export const JIRA_EMAIL = "dana@acme.example";
export const JIRA_TOKEN = "jira-api-token-0123456789";
export const JIRA_CLOUD_ID = "11111111-2222-3333-4444-555555555555";
export const STUB_BUDGET_MS = 10;
export const PASSED = { ok: true, value: undefined };
/** A repository's Jira entry listing one project. */
export const JIRA_TRACKER: TrackerConfig = {
  kind: "jira",
  projectKeys: ["ACME"],
};

export const JIRA_ROOT: SharedRootDeps = {
  env: { JIRA_EMAIL, JIRA_API_TOKEN: JIRA_TOKEN },
  contextSources: [{ type: "jira", site: JIRA_SITE }],
};

const FOUND: CloudIdAnswer = { ok: true, value: JIRA_CLOUD_ID };
export const NO_SUCH_SITE: CloudIdAnswer = {
  ok: false,
  error: {
    reason: JiraCloudIdFailureReasons.NO_SUCH_SITE,
    detail: "jira answered 404",
  },
};
export const UNREACHABLE: CloudIdAnswer = {
  ok: false,
  error: {
    reason: JiraCloudIdFailureReasons.UNKNOWN,
    detail: "jira unreachable",
  },
};
const NO_ANSWER: CloudIdAnswer = {
  ok: false,
  error: {
    reason: JiraCloudIdFailureReasons.UNKNOWN,
    detail: `no answer within ${STUB_BUDGET_MS} ms`,
  },
};

/** Settles once `signal` aborts, as a `fetch` that never answers does. */
function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export interface JiraStubAnswers {
  readonly cloudId?: CloudIdAnswer | "stalled";
  readonly scope?: JiraScopeCheck | "stalled";
}

export interface JiraTransportStub {
  readonly transport: JiraTransport;
  readonly lookups: string[];
  readonly sessions: JiraSession[];
}

/** A transport that answers as told and keeps what it was asked; `stalled` answers only once its signal aborts. */
export function stubJiraTransport(
  answers: JiraStubAnswers = {},
): JiraTransportStub {
  const { cloudId = FOUND, scope = JiraScopeChecks.SCOPE_LIMITED } = answers;
  const lookups: string[] = [];
  const sessions: JiraSession[] = [];
  const transport: JiraTransport = {
    timeoutMs: STUB_BUDGET_MS,
    readIssue: () => Promise.reject(new Error("the boot step reads no issue")),
    async readCloudId(site, signal) {
      lookups.push(site);
      if (cloudId !== "stalled") {
        return cloudId;
      }
      await waitForAbort(signal);
      return NO_ANSWER;
    },
    async checkTokenScope(session) {
      sessions.push(session);
      if (scope !== "stalled") {
        return scope;
      }
      await waitForAbort(session.signal);
      return JiraScopeChecks.UNKNOWN;
    },
  };
  return { transport, lookups, sessions };
}
