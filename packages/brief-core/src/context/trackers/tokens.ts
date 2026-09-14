import type { Result } from "types/utils";
import { ENV_VAR_NAME, type ConfigError } from "generators";
import { refuseTrackerRead } from "./refusal";

/** Read a credential from the root's env by NAME; the value never echoes. */
export function resolveTokenByName(
  env: Record<string, string | undefined>,
  tokenEnv: string,
  owner: string,
): Result<string, ConfigError> {
  if (!ENV_VAR_NAME.test(tokenEnv)) {
    return refuseTrackerRead([
      `${owner}: tokenEnv must be an environment variable NAME (UPPERCASE letters, digits, underscores) — never a token value`,
    ]);
  }
  const token = env[tokenEnv];
  if (typeof token !== "string" || token.length === 0) {
    return refuseTrackerRead([
      `${tokenEnv}: ${owner} integration token env var is not set`,
    ]);
  }
  return { ok: true, value: token };
}
