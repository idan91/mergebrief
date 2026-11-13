import { TicketTrackers, type Result } from "types";
import {
  DEFAULT_JIRA_EMAIL_ENV,
  DEFAULT_JIRA_TOKEN_ENV,
  type ConfigError,
} from "generators";
import { TicketUnreadReasons } from "../../../types";
import { ContextProviderTypes } from "../../types";
import { failRead, type ReadResult } from "../read-failure";
import { refuseTrackerRead } from "../refusal";
import { resolveCredentialByName } from "../tokens";
import type { PrimaryRead, SharedRootDeps } from "../types";
import type { JiraTransport } from "./transport";

function readUnsupported(): Promise<ReadResult<never>> {
  return Promise.resolve(
    failRead(
      TicketUnreadReasons.UNSUPPORTED,
      "this build does not read Jira issues yet",
    ),
  );
}

/** Jira's read for one root: the site's `contextSources` entry, its account email and its API token, each variable by NAME. */
export function createJiraRead(
  shared: SharedRootDeps,
  transport: JiraTransport | undefined,
): Result<PrimaryRead, ConfigError> {
  if (transport === undefined) {
    return refuseTrackerRead(["jira: no transport bound at this root"]);
  }
  const entry = shared.contextSources.find(
    (source) => source.type === ContextProviderTypes.JIRA,
  );
  if (entry === undefined) {
    return refuseTrackerRead([
      "jira: no `contextSources` entry of type jira on this deployment",
    ]);
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
    value: { kind: TicketTrackers.JIRA, readPrimary: readUnsupported },
  };
}
