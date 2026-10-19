import { z } from "zod/v4";
import type { Result } from "types/utils";
import { parseAllowedHosts } from "./host-check";
import type { WebServerConfig } from "./types";

const DEFAULT_HOSTNAME = "0.0.0.0";
const DEFAULT_PORT = 3000;
const HIGHEST_PORT = 65_535;

const HostSchema = z.string().min(1);
const WholePortSchema = z.coerce.number().int();
const PortSchema = WholePortSchema.min(1).max(HIGHEST_PORT);
const PublicBaseUrlSchema = z.string();

const WebServerEnvSchema = z.object({
  MERGEBRIEF_WEB_HOST: HostSchema.optional(),
  MERGEBRIEF_WEB_PORT: PortSchema.optional(),
  PUBLIC_BASE_URL: PublicBaseUrlSchema.optional(),
});

/** The listener's config from the process env; a bad value refuses boot. */
export function loadWebServerConfig(
  env: Readonly<Record<string, string | undefined>>,
): Result<WebServerConfig, string> {
  const parsed = WebServerEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") ?? "env"} is invalid` };
  }

  const allowedHosts = parseAllowedHosts(parsed.data.PUBLIC_BASE_URL);
  if (!allowedHosts.ok) {
    return allowedHosts;
  }
  return {
    ok: true,
    value: {
      hostname: parsed.data.MERGEBRIEF_WEB_HOST ?? DEFAULT_HOSTNAME,
      port: parsed.data.MERGEBRIEF_WEB_PORT ?? DEFAULT_PORT,
      allowedHosts: allowedHosts.value,
    },
  };
}
