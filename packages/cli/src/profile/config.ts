// Per-profile config: Zod-validated JSON at `<configDir>/config.json`,
// written 0600 — the token is stored PLAINTEXT by design (no OS keychain in
// v1; the mint UI carries the disclaimer). Profile resolution order is LOCKED:
//   explicit `--profile` flag / MERGEBRIEF_PROFILE env
//     → `owners:` match on the git-remote owner
//       → the default profile.
// `MERGEBRIEF_TOKEN` overrides the STORED TOKEN of whatever profile resolved
// — it never changes which profile resolves.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Result } from "types";
import { CliError, ExitCodes } from "../exit";

const profileSchema = z.object({
  baseUrl: z.string().url(),
  /** Plaintext by design (0600 file); MERGEBRIEF_TOKEN overrides it. */
  token: z.string().optional(),
  /**
   * GitHub owners (org/user slugs) this profile serves — the `owners:`
   * arm of profile resolution.
   */
  owners: z.array(z.string().min(1)).optional(),
  /**
   * Extra static headers on every request — the IdP escape hatch for
   * proxies that need e.g. a client-id header alongside the Bearer.
   */
  headers: z.record(z.string(), z.string()).optional(),
});
export type Profile = z.infer<typeof profileSchema>;

const configSchema = z.object({
  defaultProfile: z.string().optional(),
  profiles: z.record(z.string(), profileSchema).default({}),
});
export type CliConfig = z.infer<typeof configSchema>;

export interface ConfigEnv {
  readonly [key: string]: string | undefined;
}

/** Read + validate the config file. Absent file = empty config (first run). */
export function loadConfig(configDir: string): Result<CliConfig, string> {
  const path = join(configDir, "config.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ok: true, value: { profiles: {} } };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false, error: `config at ${path} is not valid JSON` };
  }
  const parsed = configSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      error: `config at ${path} is malformed: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  }
  return { ok: true, value: parsed.data };
}

/** Write the config with owner-only permissions (it holds token plaintext). */
export function saveConfig(configDir: string, config: CliConfig): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, "config.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies on CREATE — an existing file keeps its old
  // permissions through the rewrite, so enforce 0600 explicitly.
  chmodSync(path, 0o600);
}

export interface ResolvedProfile {
  readonly name: string;
  readonly profile: Profile;
  /** The effective Bearer token: MERGEBRIEF_TOKEN env beats the stored one. */
  readonly token: string | undefined;
}

export interface ResolveProfileInput {
  readonly config: CliConfig;
  readonly env: ConfigEnv;
  /** `--profile` value, if given. */
  readonly flagProfile?: string | undefined;
  /** Owner slug inferred from `git remote get-url origin`, if any. */
  readonly gitRemoteOwner?: string | undefined;
}

/**
 * The locked resolution order. A named profile that does not exist is a hard
 * USAGE error, never a silent fallback.
 */
export function resolveProfile(input: ResolveProfileInput): ResolvedProfile {
  const { config, env } = input;
  const names = Object.keys(config.profiles);

  const explicit = input.flagProfile ?? env["MERGEBRIEF_PROFILE"];
  let name: string | undefined;
  if (explicit !== undefined) {
    if (config.profiles[explicit] === undefined) {
      throw new CliError(
        ExitCodes.USAGE,
        `profile "${explicit}" is not configured (run: mergebrief auth login --profile ${explicit})`,
      );
    }
    name = explicit;
  } else if (input.gitRemoteOwner !== undefined) {
    name = names.find((candidate) =>
      (config.profiles[candidate]?.owners ?? []).includes(
        input.gitRemoteOwner ?? "",
      ),
    );
  }
  if (name === undefined) {
    name = config.defaultProfile ?? (names.length === 1 ? names[0] : undefined);
  }
  const profile = name === undefined ? undefined : config.profiles[name];
  if (name === undefined || profile === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "no profile resolved — run: mergebrief auth login",
    );
  }
  return {
    name,
    profile,
    token: env["MERGEBRIEF_TOKEN"] ?? profile.token,
  };
}

/** Parse the owner (org/user) out of a git origin remote URL, if possible. */
export function ownerFromOriginUrl(url: string): string | undefined {
  // git@github.com:owner/name.git | https://github.com/owner/name(.git)
  const match = /[:/]([^/:]+)\/[^/]+?(?:\.git)?$/.exec(url.trim());
  return match?.[1];
}

/** Parse `owner/name` from a git origin remote URL, if possible. */
export function fullNameFromOriginUrl(url: string): string | undefined {
  const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url.trim());
  return match?.[1];
}
