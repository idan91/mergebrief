import { z } from "zod/v4";
import type { Result } from "types/utils";
import { JIRA_SITE } from "generators";
import { TicketUnreadReasons } from "../../../../types";
import { failRead } from "../../read-failure";
import {
  JiraCloudIdFailureReasons,
  JiraScopeChecks,
  type JiraCloudIdFailure,
  type JiraCloudIdFailureReason,
  type JiraIssue,
  type JiraParent,
  type JiraReadFailure,
  type JiraScopeCheck,
  type JiraSession,
  type JiraTransport,
} from "./port";

const JIRA_API_BASE = "https://api.atlassian.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const ISSUE_FIELDS =
  "summary,status,issuetype,priority,assignee,labels,parent,description";
/**
 * A description holds at most 32,767 characters and the largest recorded
 * answer is 34,720 bytes; 1 MiB leaves room for three-byte characters
 * wrapped in a node per mark, the tree's worst shape.
 */
const MAX_ISSUE_BYTES = 1024 * 1024;
/** An error body is a line or two of JSON; past this it is not one. */
const MAX_ERROR_BODY_BYTES = 16 * 1024;
/** `tenant_info` answers one short JSON object. */
const MAX_TENANT_INFO_BYTES = 4 * 1024;
/** Recorded cloud ids run to 46 characters; the bound only refuses junk. */
const MAX_CLOUD_ID_LENGTH = 128;
/** Opaque, but it becomes a path segment: a dot or slash could rewrite the API route. */
const CLOUD_ID = /^[A-Za-z0-9-]+$/;
const TENANT_INFO_PATH = "/_edge/tenant_info";

const FAILURE_CATEGORY_HEADER = "x-failure-category";
/** The gateway's own 404: no site answers to the cloud id. */
const UNKNOWN_SITE_CATEGORY = "FAILURE_CLIENT_TCS";
/** A token refused for scope, not as a credential: `read:jira-work` alone cannot read `/myself`. */
const SCOPE_CHECK_CATEGORY = "FAILURE_CLIENT_SCOPE_CHECK";
const AUTH_CATEGORY = "FAILURE_CLIENT_AUTH";
const SCOPE_MISMATCH_MESSAGE = "Unauthorized; scope does not match";
/** Gateway failure categories are SHOUT_CASE words; anything else is not echoed. */
const FAILURE_CATEGORY_TOKEN = /^[A-Z_]{1,40}$/;
/** A failed lookup fails the read with one fixed detail per reason. */
const CLOUD_ID_FAILURE_DETAILS = {
  [JiraCloudIdFailureReasons.NO_SUCH_SITE]:
    "no jira site answers at the configured host",
  [JiraCloudIdFailureReasons.UNKNOWN]: "jira site lookup had no usable answer",
} as const;

/** The `fetch` slice the HTTP transport uses; injectable so tests replay recorded answers. */
export type JiraFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: "error";
  },
) => Promise<Response>;

interface JiraHttpTransportOptions {
  readonly fetch?: JiraFetch | undefined;
  readonly timeoutMs?: number | undefined;
}

// --- wire shapes: what Jira answers, decoded here and nowhere else

const namedSchema = z.looseObject({ name: z.string() });

const issueSchema = z.looseObject({
  key: z.string(),
  fields: z.looseObject({
    summary: z.string(),
    status: namedSchema,
    issuetype: namedSchema,
    priority: namedSchema.nullish(),
    assignee: z.looseObject({ displayName: z.string() }).nullish(),
    labels: z.array(z.string()).nullish(),
    parent: z
      .looseObject({
        key: z.string(),
        fields: z.looseObject({ summary: z.string() }),
      })
      .nullish(),
    description: z
      .looseObject({ type: z.literal("doc"), content: z.array(z.unknown()) })
      .nullish(),
  }),
});

const issueErrorSchema = z.looseObject({
  errorMessages: z.array(z.string()),
});

const gatewayErrorSchema = z.looseObject({
  status: z.literal(404),
  error: z.string(),
  path: z.string(),
});

const refusalSchema = z.looseObject({ message: z.string() });

const tenantInfoSchema = z.looseObject({
  cloudId: z.string().max(MAX_CLOUD_ID_LENGTH).regex(CLOUD_ID),
});

/** What one call needs besides its URL; `timeoutMs` only words the abort detail. */
interface CallContext {
  readonly fetch: JiraFetch;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function buildApiUrl(cloudId: string, path: string): string {
  return `${JIRA_API_BASE}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/${path}`;
}

function buildAuthHeaders(session: JiraSession): Record<string, string> {
  const pair = Buffer.from(`${session.email}:${session.token}`, "utf8");
  return {
    Authorization: `Basic ${pair.toString("base64")}`,
    Accept: "application/json",
  };
}

function describeLostAnswer(context: CallContext): string {
  if (context.signal.aborted) {
    return `no answer within ${context.timeoutMs} ms`;
  }
  return "jira unreachable";
}

/** One GET that never follows a redirect, so the credential never leaves for another host. */
async function sendGet(
  context: CallContext,
  url: string,
  headers: Record<string, string>,
): Promise<Result<Response, string>> {
  try {
    const response = await context.fetch(url, {
      method: "GET",
      headers,
      signal: context.signal,
      redirect: "error",
    });
    return { ok: true, value: response };
  } catch {
    return { ok: false, error: describeLostAnswer(context) };
  }
}

/** The body as text, or `undefined` once it passes `maxBytes`; nothing past the ceiling is buffered. */
async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let byteCount = 0;

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return text + decoder.decode();
    }
    byteCount += chunk.value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

async function readBody(
  context: CallContext,
  response: Response,
  maxBytes: number,
): Promise<Result<string, string>> {
  try {
    const text = await readBoundedText(response, maxBytes);
    if (text === undefined) {
      return { ok: false, error: `jira answer passed ${maxBytes} bytes` };
    }
    return { ok: true, value: text };
  } catch {
    return { ok: false, error: describeLostAnswer(context) };
  }
}

/** Frees the connection once the status alone answers. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status already answered; a body that fails to close changes nothing.
  }
}

/** The gateway's own 404: the cloud id no longer names a site. */
function failUnknownCloudId(): Result<never, JiraReadFailure> {
  return {
    ok: false,
    error: {
      reason: TicketUnreadReasons.TIMEOUT,
      detail: "jira knows no site for this cloud id",
      unknownCloudId: true,
    },
  };
}

/** Jira answers one 404 for a missing issue, a hidden one and an unknown project. */
async function describeIssueNotFound(
  context: CallContext,
  response: Response,
  detail: string,
): Promise<Result<never, JiraReadFailure>> {
  const category = response.headers.get(FAILURE_CATEGORY_HEADER);
  if (category === UNKNOWN_SITE_CATEGORY) {
    await discardBody(response);
    return failUnknownCloudId();
  }

  const body = await readBody(context, response, MAX_ERROR_BODY_BYTES);
  const json = body.ok ? parseJson(body.value) : undefined;
  if (issueErrorSchema.safeParse(json).success) {
    return failRead(TicketUnreadReasons.NOT_FOUND, detail);
  }
  if (gatewayErrorSchema.safeParse(json).success) {
    return failUnknownCloudId();
  }
  return failRead(
    TicketUnreadReasons.TIMEOUT,
    `${detail} with an unknown body`,
  );
}

/** A non-2xx issue answer mapped to the closed reason set; a 429 is never retried. */
async function describeIssueFailure(
  context: CallContext,
  response: Response,
): Promise<Result<never, JiraReadFailure>> {
  const { status } = response;
  const category = response.headers.get(FAILURE_CATEGORY_HEADER) ?? "";
  const categorySuffix = FAILURE_CATEGORY_TOKEN.test(category)
    ? ` ${category}`
    : "";
  const detail = `jira answered ${status}${categorySuffix}`;

  if (status === 404) {
    return describeIssueNotFound(context, response, detail);
  }
  await discardBody(response);
  if (status === 401 || status === 403) {
    return failRead(TicketUnreadReasons.NO_CREDENTIAL, detail);
  }
  if (status === 429) {
    return failRead(TicketUnreadReasons.RATE_LIMITED, detail);
  }
  return failRead(TicketUnreadReasons.TIMEOUT, detail);
}

function shapeParent(
  raw: z.infer<typeof issueSchema>["fields"]["parent"],
): JiraParent | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  return { key: raw.key, summary: raw.fields.summary };
}

function shapeIssue(raw: z.infer<typeof issueSchema>): JiraIssue {
  const { fields } = raw;
  return {
    key: raw.key,
    summary: fields.summary,
    status: fields.status.name,
    issueType: fields.issuetype.name,
    priority: fields.priority?.name,
    assigneeName: fields.assignee?.displayName,
    labels: fields.labels ?? [],
    parent: shapeParent(fields.parent),
    description: fields.description ?? undefined,
  };
}

async function readIssueOverHttp(
  context: CallContext,
  session: JiraSession,
  cloudId: string,
  key: string,
): Promise<Result<JiraIssue, JiraReadFailure>> {
  const path = `issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`;
  const url = buildApiUrl(cloudId, path);
  const sent = await sendGet(context, url, buildAuthHeaders(session));
  if (!sent.ok) {
    return failRead(TicketUnreadReasons.TIMEOUT, sent.error);
  }
  if (!sent.value.ok) {
    return describeIssueFailure(context, sent.value);
  }

  const body = await readBody(context, sent.value, MAX_ISSUE_BYTES);
  if (!body.ok) {
    return failRead(TicketUnreadReasons.TIMEOUT, body.error);
  }
  const json = parseJson(body.value);
  if (json === undefined) {
    return failRead(TicketUnreadReasons.TIMEOUT, "jira sent unreadable JSON");
  }
  const issue = issueSchema.safeParse(json);
  if (!issue.success) {
    return failRead(
      TicketUnreadReasons.TIMEOUT,
      "jira issue had an unexpected shape",
    );
  }
  return { ok: true, value: shapeIssue(issue.data) };
}

function failCloudId(
  reason: JiraCloudIdFailureReason,
  detail: string,
): Result<never, JiraCloudIdFailure> {
  return { ok: false, error: { reason, detail } };
}

/**
 * The tenant info URL of a Jira Cloud site. Any other host is refused before
 * a request leaves, so the lookup cannot be pointed at an internal address.
 */
function buildTenantInfoUrl(site: string): string | undefined {
  if (!JIRA_SITE.test(site)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(TENANT_INFO_PATH, `https://${site}`);
  } catch {
    return undefined;
  }
  if (url.hostname !== site) {
    return undefined;
  }
  return url.toString();
}

async function readCloudIdOverHttp(
  context: CallContext,
  site: string,
): Promise<Result<string, JiraCloudIdFailure>> {
  const url = buildTenantInfoUrl(site);
  if (url === undefined) {
    return failCloudId(
      JiraCloudIdFailureReasons.NO_SUCH_SITE,
      "not a site host",
    );
  }
  const sent = await sendGet(context, url, { Accept: "application/json" });
  if (!sent.ok) {
    return failCloudId(JiraCloudIdFailureReasons.UNKNOWN, sent.error);
  }

  const response = sent.value;
  if (!response.ok) {
    await discardBody(response);
    const reason =
      response.status === 404
        ? JiraCloudIdFailureReasons.NO_SUCH_SITE
        : JiraCloudIdFailureReasons.UNKNOWN;
    return failCloudId(reason, `jira answered ${response.status}`);
  }

  const body = await readBody(context, response, MAX_TENANT_INFO_BYTES);
  if (!body.ok) {
    return failCloudId(JiraCloudIdFailureReasons.UNKNOWN, body.error);
  }
  const tenant = tenantInfoSchema.safeParse(parseJson(body.value));
  if (!tenant.success) {
    return failCloudId(
      JiraCloudIdFailureReasons.UNKNOWN,
      "jira tenant info had an unexpected shape",
    );
  }
  return { ok: true, value: tenant.data.cloudId };
}

/** Each site's cloud id, kept for the life of one transport. */
type CloudIdMemory = Map<string, string>;

/** Asks the site; only a found cloud id is remembered, so a failed lookup asks again next time. */
async function lookUpCloudId(
  context: CallContext,
  cloudIds: CloudIdMemory,
  site: string,
): Promise<Result<string, JiraCloudIdFailure>> {
  const found = await readCloudIdOverHttp(context, site);
  if (found.ok) {
    cloudIds.set(site, found.value);
  }
  return found;
}

async function resolveCloudId(
  context: CallContext,
  cloudIds: CloudIdMemory,
  site: string,
): Promise<Result<string, JiraCloudIdFailure>> {
  const known = cloudIds.get(site);
  if (known !== undefined) {
    return { ok: true, value: known };
  }
  return lookUpCloudId(context, cloudIds, site);
}

async function readIssueOnSite(
  context: CallContext,
  cloudIds: CloudIdMemory,
  session: JiraSession,
  key: string,
): Promise<Result<JiraIssue, JiraReadFailure>> {
  const cloudId = await resolveCloudId(context, cloudIds, session.site);
  if (!cloudId.ok) {
    const detail = CLOUD_ID_FAILURE_DETAILS[cloudId.error.reason];
    return failRead(TicketUnreadReasons.TIMEOUT, detail);
  }

  const read = await readIssueOverHttp(context, session, cloudId.value, key);
  if (!read.ok && read.error.unknownCloudId === true) {
    cloudIds.delete(session.site);
  }
  return read;
}

/** A 401 from `/myself`: the header decides, the body only when the header is missing. */
async function readRefusalScope(
  context: CallContext,
  response: Response,
): Promise<JiraScopeCheck> {
  const category = response.headers.get(FAILURE_CATEGORY_HEADER);
  if (category === SCOPE_CHECK_CATEGORY) {
    await discardBody(response);
    return JiraScopeChecks.SCOPE_LIMITED;
  }
  if (category === AUTH_CATEGORY) {
    await discardBody(response);
    return JiraScopeChecks.REFUSED;
  }

  const body = await readBody(context, response, MAX_ERROR_BODY_BYTES);
  const refusal = refusalSchema.safeParse(
    body.ok ? parseJson(body.value) : undefined,
  );
  const scopeMismatch =
    refusal.success && refusal.data.message === SCOPE_MISMATCH_MESSAGE;
  if (scopeMismatch) {
    return JiraScopeChecks.SCOPE_LIMITED;
  }
  return JiraScopeChecks.REFUSED;
}

/** What the token can do, from `/myself`; the account it names is never read. */
async function checkTokenScopeOverHttp(
  context: CallContext,
  cloudIds: CloudIdMemory,
  session: JiraSession,
): Promise<JiraScopeCheck> {
  const cloudId = await resolveCloudId(context, cloudIds, session.site);
  if (!cloudId.ok) {
    return JiraScopeChecks.UNKNOWN;
  }

  const url = buildApiUrl(cloudId.value, "myself");
  const sent = await sendGet(context, url, buildAuthHeaders(session));
  if (!sent.ok) {
    return JiraScopeChecks.UNKNOWN;
  }

  const response = sent.value;
  if (response.status === 401) {
    return readRefusalScope(context, response);
  }
  await discardBody(response);
  if (response.ok) {
    return JiraScopeChecks.BROADER;
  }
  return JiraScopeChecks.UNKNOWN;
}

/** The one transport: direct calls to Jira Cloud's REST API through Atlassian's gateway. */
export function createJiraHttpTransport(
  options: JiraHttpTransportOptions = {},
): JiraTransport {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cloudIds: CloudIdMemory = new Map();

  return {
    timeoutMs,

    readIssue(session, key) {
      const context = { fetch, timeoutMs, signal: session.signal };
      return readIssueOnSite(context, cloudIds, session, key);
    },

    readCloudId(site, signal) {
      return lookUpCloudId({ fetch, timeoutMs, signal }, cloudIds, site);
    },

    checkTokenScope(session) {
      const context = { fetch, timeoutMs, signal: session.signal };
      return checkTokenScopeOverHttp(context, cloudIds, session);
    },
  };
}
