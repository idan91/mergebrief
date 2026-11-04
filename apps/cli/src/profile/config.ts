// Per-profile config: Zod-validated JSON at `<configDir>/config.json`,
// written 0600; the token is stored PLAINTEXT by design (no OS keychain in
// v1; the mint UI carries the disclaimer). Profile resolution order is LOCKED:
//   explicit `--profile` flag / MERGEBRIEF_PROFILE env
//     → `owners:` match on the git-remote owner
//       → the default profile.
// `MERGEBRIEF_TOKEN` overrides the STORED TOKEN of the resolved profile, never picks
// one, and is refused where only an owner match moved a request off the default.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import type { Result } from "types/utils";
import { CliError, ExitCodes } from "../exit";

const profileSchema = z.object({
  baseUrl: z.url(),
  /** Plaintext by design (0600 file); MERGEBRIEF_TOKEN overrides it. */
  token: z.string().optional(),
  /**
   * GitHub owners (org/user slugs) this profile serves; the `owners:`
   * arm of profile resolution.
   */
  owners: z.array(z.string().min(1)).optional(),
  /**
   * Extra static headers on every request; the IdP escape hatch for
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

export function loadConfigOrRefuse(configDir: string): CliConfig {
  const config = loadConfig(configDir);
  if (!config.ok) {
    throw new CliError(ExitCodes.USAGE, config.error);
  }
  return config.value;
}

/** Write the config with owner-only permissions (it holds token plaintext). */
export function saveConfig(configDir: string, config: CliConfig): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, "config.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies on CREATE; an existing file keeps its old
  // permissions through the rewrite, so enforce 0600 explicitly.
  chmodSync(path, 0o600);
}

export interface ResolvedProfile {
  readonly name: string;
  readonly profile: Profile;
  /** The effective Bearer token: MERGEBRIEF_TOKEN env beats the stored one. */
  readonly token: string | undefined;
  /** Names only: a failure may print them, so never a profile's other fields. */
  readonly otherProfileNames: readonly string[];
}

export interface StoredProfile {
  readonly name: string;
  readonly profile: Profile;
  /** Only an owner match chose it, and it isn't the default. */
  readonly routesAway: boolean;
  /** Names only: a failure may print them, so never a profile's other fields. */
  readonly otherProfileNames: readonly string[];
}

export interface ResolveProfileInput {
  readonly config: CliConfig;
  readonly env: ConfigEnv;
  /** `--profile` value, if given. */
  readonly flagProfile?: string | undefined;
  /** Owner slug inferred from `git remote get-url origin`, if any. */
  readonly gitRemoteOwner?: string | undefined;
}

/** The profile a run lands on when nothing names one: a lone profile is the default. */
export function readDefaultProfileName(config: CliConfig): string | undefined {
  const names = Object.keys(config.profiles);
  return config.defaultProfile ?? (names.length === 1 ? names[0] : undefined);
}

function holdsOwner(profile: Profile, slug: string): boolean {
  return (profile.owners ?? []).some((held) => held.toLowerCase() === slug);
}

/** GitHub owner slugs ignore case, so `Acme` and `acme` route the same way. */
export function findOwnerProfileName(
  config: CliConfig,
  owner: string,
): string | undefined {
  const slug = owner.toLowerCase();
  const routed = Object.entries(config.profiles).find(([, profile]) =>
    holdsOwner(profile, slug),
  );
  return routed?.[0];
}

/** The profile an owner routes to when no default answers the same: the one name a pasted or env token must not follow. */
export function findRoutedAwayProfileName(
  config: CliConfig,
  owner: string,
): string | undefined {
  const routed = findOwnerProfileName(config, owner);
  return routed === readDefaultProfileName(config) ? undefined : routed;
}

/** Own keys only: `constructor` must not resolve through the object's prototype. */
export function readHeldProfile(
  config: CliConfig,
  name: string | undefined,
): Profile | undefined {
  if (name === undefined || !Object.hasOwn(config.profiles, name)) {
    return undefined;
  }
  return config.profiles[name];
}

/**
 * The locked resolution order, for a command that sends no token. A named
 * profile that does not exist is a hard USAGE error, never a silent fallback.
 */
export function resolveStoredProfile(
  input: ResolveProfileInput,
): StoredProfile {
  const { config, env } = input;

  const explicit = input.flagProfile ?? env["MERGEBRIEF_PROFILE"];
  let name: string | undefined;
  let routesAway = false;
  if (explicit !== undefined) {
    if (readHeldProfile(config, explicit) === undefined) {
      throw new CliError(
        ExitCodes.USAGE,
        `profile "${explicit}" is not configured (run: mergebrief auth login --profile ${explicit})`,
      );
    }
    name = explicit;
  } else if (input.gitRemoteOwner !== undefined) {
    name = findOwnerProfileName(config, input.gitRemoteOwner);
    routesAway =
      findRoutedAwayProfileName(config, input.gitRemoteOwner) !== undefined;
  }
  if (name === undefined) {
    name = readDefaultProfileName(config);
  }
  const profile = readHeldProfile(config, name);
  if (name === undefined || profile === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "no profile resolved; run: mergebrief auth login",
    );
  }
  return {
    name,
    profile,
    routesAway,
    otherProfileNames: Object.keys(config.profiles).filter(
      (candidate) => candidate !== name,
    ),
  };
}

/**
 * The stored profile with the token a request sends. A clone's origin must not
 * choose where the env token goes: a stored token stays with its own instance,
 * but this one would follow the route.
 */
export function resolveProfile(input: ResolveProfileInput): ResolvedProfile {
  const { routesAway, ...stored } = resolveStoredProfile(input);
  const envToken = input.env["MERGEBRIEF_TOKEN"];
  const originPicksInstance = routesAway && envToken !== undefined;
  if (originPicksInstance) {
    throw new CliError(
      ExitCodes.USAGE,
      `MERGEBRIEF_TOKEN is set and this clone's owner routes to "${stored.name}", not the default profile; name the instance it is for with --profile or MERGEBRIEF_PROFILE`,
    );
  }
  return { ...stored, token: envToken ?? stored.profile.token };
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
