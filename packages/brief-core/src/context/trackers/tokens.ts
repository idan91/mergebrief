import type { Result } from "types/utils";
import {
  ENV_VAR_NAME,
  type ConfigError,
  type ContextSourceType,
} from "generators";
import { refuseTrackerRead } from "./refusal";

/** One credential variable a tracker reads, as its refusals name it. */
export interface CredentialVariable {
  /** The tracker kind the refusal names first: `notion`, `jira`. */
  readonly owner: ContextSourceType;
  /** The `contextSources` field that names the variable: `tokenEnv`, `emailEnv`. */
  readonly field: "tokenEnv" | "emailEnv";
  /** The variable's NAME, from that field or its default. */
  readonly name: string;
  /** What the variable holds, as a refusal words it. */
  readonly holds: "integration token" | "account email" | "API token";
}

/** Read a credential from the root's env by NAME; the value never echoes. */
export function resolveCredentialByName(
  env: Record<string, string | undefined>,
  variable: CredentialVariable,
): Result<string, ConfigError> {
  const { owner, field, name, holds } = variable;
  if (!ENV_VAR_NAME.test(name)) {
    return refuseTrackerRead([
      `${owner}: ${field} must be an environment variable NAME (UPPERCASE letters, digits, underscores) — never a token value`,
    ]);
  }
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    return refuseTrackerRead([`${name}: ${owner} ${holds} env var is not set`]);
  }
  return { ok: true, value };
}
