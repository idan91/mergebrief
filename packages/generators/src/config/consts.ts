import { Runtimes } from "types/runtime";

/**
 * SHOUT_CASE env-var identifier. Anything else is refused with a FIXED
 * message: a misconfiguration that pastes the key VALUE into `apiKeyEnv`
 * must never see that value echoed into errors or logs, and real tokens
 * (`ntn_…`, `secret_…`) are lowercase, so lowercase names are refused too.
 * Every by-NAME credential field in the instance config shares it.
 */
export const ENV_VAR_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** The instance config a process reads from its workspace root when `MERGEBRIEF_CONFIG` is unset. */
export const DEFAULT_CONFIG_FILE = "mergebrief.config.yaml";

/** The `RUNTIME_MARKER_VAR` value the compose worker image bakes. */
export const COMPOSE_WORKER_RUNTIME = Runtimes.COMPOSE_WORKER;
