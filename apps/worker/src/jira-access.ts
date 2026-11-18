import {
  JiraCloudIdFailureReasons,
  JiraScopeChecks,
  resolveJiraAccount,
  type JiraScopeCheck,
  type JiraTransport,
  type SharedRootDeps,
} from "brief-core";
import type { Logger } from "logging";
import type { Result } from "types/utils";

export interface JiraAccessDeps {
  readonly transport: JiraTransport;
  readonly log: Logger;
}

/** The token answers an operator acts on; the expected `scope-limited` and an `unknown` say nothing. */
const TOKEN_CHECK_MESSAGES: Readonly<Partial<Record<JiraScopeCheck, string>>> =
  {
    [JiraScopeChecks.BROADER]:
      "jira: the API token can do more than read issues; replace it with an API token with scopes that holds read:jira-work only",
    [JiraScopeChecks.REFUSED]:
      "jira: Jira refused the account email and API token; every Jira read reports its ticket unread as no-credential until both variables are right and the worker restarts",
  };

/**
 * Asks Atlassian about the `type: jira` entry before the worker takes jobs,
 * inside the transport's one budget. Only a host with no Jira site refuses,
 * as a config error; a site that cannot be checked and every token answer
 * let boot go on. A config with no such entry makes no call.
 */
export async function checkJiraAccess(
  root: SharedRootDeps,
  deps: JiraAccessDeps,
): Promise<Result<void, string>> {
  const { transport, log } = deps;
  const account = resolveJiraAccount(root);
  if (!account.ok) {
    return { ok: false, error: account.error.issues.join("; ") };
  }
  if (account.value === undefined) {
    return { ok: true, value: undefined };
  }
  const { site } = account.value;
  const signal = AbortSignal.timeout(transport.timeoutMs);

  const cloudId = await transport.readCloudId(site, signal);
  if (!cloudId.ok) {
    const { reason, detail } = cloudId.error;
    if (reason === JiraCloudIdFailureReasons.NO_SUCH_SITE) {
      return {
        ok: false,
        error: `jira: no Jira site answers at \`site\` ${site}, check the \`contextSources\` entry of type jira`,
      };
    }
    log.info(
      "jira: the site could not be checked at boot; the first read will look it up",
      { site, detail },
    );
    return { ok: true, value: undefined };
  }

  const outcome = await transport.checkTokenScope({ ...account.value, signal });
  const message = TOKEN_CHECK_MESSAGES[outcome];
  if (message === undefined) {
    return { ok: true, value: undefined };
  }
  const fields = { evt: "jira.token.check", outcome, site };
  if (outcome === JiraScopeChecks.REFUSED) {
    log.error(message, fields);
  } else {
    log.warn(message, fields);
  }
  return { ok: true, value: undefined };
}
