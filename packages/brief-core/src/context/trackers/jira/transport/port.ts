import type { Result, ValueOf } from "types/utils";
import type { ContextReadFailure } from "../../../types";

/** One read's site and credential; the email and token ride only in a header, never in a detail. */
export interface JiraSession {
  /** The `.atlassian.net` host from config, lower-case. */
  readonly site: string;
  readonly email: string;
  readonly token: string;
  readonly signal: AbortSignal;
}

export interface JiraParent {
  readonly key: string;
  readonly summary: string;
}

/** One issue as the transport decoded it; of the people on it, only the assignee's display name. */
export interface JiraIssue {
  /** The key Jira answered under, which differs from the one asked for once an issue moves. */
  readonly key: string;
  readonly summary: string;
  readonly status: string;
  readonly issueType: string;
  readonly priority: string | undefined;
  readonly assigneeName: string | undefined;
  readonly labels: readonly string[];
  readonly parent: JiraParent | undefined;
  /** The Atlassian Document Format tree as sent; the read walks it. */
  readonly description: unknown;
}

export const JiraCloudIdFailureReasons = {
  /** A definitive 404: no Jira site answers at this host. */
  NO_SUCH_SITE: "no-such-site",
  /** No usable answer; asking again may work. */
  UNKNOWN: "unknown",
} as const;
export type JiraCloudIdFailureReason = ValueOf<
  typeof JiraCloudIdFailureReasons
>;

export interface JiraCloudIdFailure {
  readonly reason: JiraCloudIdFailureReason;
  readonly detail: string;
}

/** What `/myself` says a token can do. */
export const JiraScopeChecks = {
  /** Refused for scope: the token has scopes and none covers `/myself`, as with `read:jira-work` alone. It does not prove that scope. */
  SCOPE_LIMITED: "scope-limited",
  /** Answered: the token can do more than read issues. */
  BROADER: "broader",
  /** Refused as a credential: bad, expired or revoked. */
  REFUSED: "refused",
  UNKNOWN: "unknown",
} as const;
export type JiraScopeCheck = ValueOf<typeof JiraScopeChecks>;

export interface JiraReadFailure extends ContextReadFailure {
  /** The gateway's own 404: the cloud id no longer names a site; the transport has forgotten it. */
  readonly unknownCloudId?: true;
}

/**
 * The port Jira's read talks through: typed operations, records decoded
 * inside the implementation. A root binds one of `JiraTransports`, one per
 * process: an instance remembers each site's cloud id for its life.
 */
export interface JiraTransport {
  /** One budget for a whole read; the read enforces it through the session signal. */
  readonly timeoutMs: number;
  /** Looks up the site's cloud id first unless remembered; a failed lookup is a `timeout`. */
  readIssue(
    session: JiraSession,
    key: string,
  ): Promise<Result<JiraIssue, JiraReadFailure>>;
  /** The cloud id of a site such as `acme.atlassian.net`, always asked without a credential; a found one is remembered. */
  readCloudId(
    site: string,
    signal: AbortSignal,
  ): Promise<Result<string, JiraCloudIdFailure>>;
  /** Looks up the cloud id like `readIssue`; a failed lookup is `unknown`. */
  checkTokenScope(session: JiraSession): Promise<JiraScopeCheck>;
}
