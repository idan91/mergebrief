import { formatDisplayText } from "brief-core/hidden-chars";
import type { Mutable } from "types";
import {
  describeOtherProfiles,
  isSendableHeader,
  type ApiClient,
} from "../../client";
import { CliError, ExitCodes } from "../../exit";
import {
  findOwnerProfileName,
  loadConfigOrRefuse,
  readDefaultProfileName,
  readHeldProfile,
  saveConfig,
  type CliConfig,
  type Profile,
  type ResolvedProfile,
} from "../../profile/config";
import { loadRepos, type RepoCacheDeps } from "../../profile/repos";
import type { CliDeps, GlobalOptions } from "../../types";
import { isRecord } from "../../utils";
import { formatSemver, parseSemver } from "../../version";
import {
  createClient,
  readGitRemoteOwner,
  resolveCliVersion,
  resolveFromDisk,
} from "../target";
import {
  DELETE_CODE,
  LAST_C0_CODE,
  LAST_C1_CODE,
  PATH_SEPARATOR,
  RELEASE_FLAG_FIELDS,
  RELEASE_STRING_FIELDS,
  TOKEN_PREFIX,
  UNSAFE_PROFILE_NAMES,
} from "./consts";
import type {
  AuthStatusBody,
  ServerReleaseFields,
  ServerStatus,
} from "./types";

/** The release fields the server sent, passed through as they came. */
function readReleaseFields(
  parsed: Record<string, unknown>,
): ServerReleaseFields {
  const fields: Mutable<ServerReleaseFields> = {};
  for (const key of RELEASE_STRING_FIELDS) {
    const value = parsed[key];
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  for (const key of RELEASE_FLAG_FIELDS) {
    const value = parsed[key];
    if (typeof value === "boolean") {
      fields[key] = value;
    }
  }
  return fields;
}

/** Probe the server (version + auth in one gated read); throws only a request it refused to send. */
async function probeServer(client: ApiClient): Promise<ServerStatus> {
  try {
    const response = await client.request({ path: "/api/version" });
    const parsed: unknown = JSON.parse(response.bodyText);
    let version: string | null = null;
    let release: ServerReleaseFields = {};
    if (isRecord(parsed)) {
      const value = parsed["version"];
      if (typeof value === "string") {
        version = value;
      }
      release = readReleaseFields(parsed);
    }
    return { reachable: true, authenticated: true, version, ...release };
  } catch (error) {
    if (error instanceof CliError && error.code === ExitCodes.USAGE) {
      throw error;
    }
    if (error instanceof CliError && error.code === ExitCodes.AUTH) {
      return { reachable: true, authenticated: false, version: null };
    }
    return { reachable: false, authenticated: null, version: null };
  }
}

async function buildAuthStatusBody(
  deps: CliDeps,
  resolved: ResolvedProfile,
): Promise<AuthStatusBody> {
  return {
    profile: resolved.name,
    baseUrl: resolved.profile.baseUrl,
    tokenConfigured: resolved.token !== undefined,
    cli: { version: resolveCliVersion(deps) },
    server: await probeServer(createClient(deps, resolved)),
  };
}

function describeAuthState(authenticated: boolean | null): string {
  if (authenticated === true) {
    return "authenticated";
  }
  if (authenticated === false) {
    return "NOT authenticated (re-mint at <baseUrl>/settings)";
  }
  return "server unreachable";
}

function isPrintable(character: string): boolean {
  const code = character.charCodeAt(0);
  const isC0 = code <= LAST_C0_CODE;
  const isDeleteOrC1 = code >= DELETE_CODE && code <= LAST_C1_CODE;
  const printable = !isC0 && !isDeleteOrC1;
  return printable;
}

/** A version as the terminal may show it: canonical when it parses, otherwise stripped of controls. */
function describeVersionText(value: string): string {
  const parsed = parseSemver(value);
  if (parsed.ok) {
    return formatSemver(parsed.value);
  }
  let printable = "";
  for (const character of value) {
    const keep = isPrintable(character);
    if (keep) {
      printable += character;
    }
  }
  return printable;
}

function emitStatus(
  deps: CliDeps,
  json: boolean,
  body: AuthStatusBody,
  otherProfileNames: readonly string[],
): void {
  if (json) {
    deps.stdout(`${JSON.stringify(body)}\n`);
    return;
  }
  // TTY rendering, explicitly NON-contractual.
  const otherProfiles =
    body.server.authenticated === true
      ? ""
      : describeOtherProfiles(otherProfileNames);
  const auth = `${describeAuthState(body.server.authenticated)}${otherProfiles}`;
  const versions = [`cli ${describeVersionText(body.cli.version)}`];
  if (body.server.version !== null) {
    versions.unshift(`server ${describeVersionText(body.server.version)}`);
  }
  if (body.server.latest !== undefined) {
    versions.push(`latest ${describeVersionText(body.server.latest)}`);
  }
  deps.stdout(
    `profile ${body.profile} → ${body.baseUrl}\n` +
      `token: ${body.tokenConfigured ? "configured" : "missing"} · ${auth}` +
      ` · ${versions.join(" · ")}\n`,
  );
}

/**
 * A clone's origin must not choose where a pasted token goes, so an owner route
 * away from the default is refused until `--profile` names the target. Unlike a
 * read, a login may name a profile not yet there.
 */
function resolveLoginProfileName(
  deps: CliDeps,
  global: GlobalOptions,
  config: CliConfig,
): string {
  const named = global.profile ?? deps.env["MERGEBRIEF_PROFILE"];
  if (named !== undefined) {
    return named;
  }

  const owner = readGitRemoteOwner(deps);
  const routed =
    owner === undefined ? undefined : findOwnerProfileName(config, owner);
  const defaultName = readDefaultProfileName(config) ?? "default";
  if (routed !== undefined && routed !== defaultName) {
    throw new CliError(
      ExitCodes.USAGE,
      `this clone's owner routes to "${routed}" but the default profile is "${defaultName}"; name the one this token is for with --profile`,
    );
  }
  return defaultName;
}

/** Headers and owners belong to an instance, so neither follows a profile to another origin. */
function shapeLoginProfile(
  existing: Profile | undefined,
  baseUrl: string,
  token: string,
): Profile {
  if (existing === undefined) {
    return { baseUrl, token };
  }
  const movesOrigin =
    new URL(existing.baseUrl).origin !== new URL(baseUrl).origin;
  return movesOrigin ? { baseUrl, token } : { ...existing, baseUrl, token };
}

/**
 * A profile name is a config key, a cache folder and text on an error line, so it
 * must survive a reload, stay inside that folder's parent and print as itself.
 */
function assertStorableProfileName(name: string): void {
  const unstorable =
    UNSAFE_PROFILE_NAMES.has(name) ||
    PATH_SEPARATOR.test(name) ||
    formatDisplayText(name) !== name;
  if (unstorable) {
    throw new CliError(
      ExitCodes.USAGE,
      `a profile can't be named "${name}": it is a config key, a cache folder and text on an error line`,
    );
  }
}

function readLoginBaseUrl(
  profileName: string,
  existing: Profile | undefined,
  flagBaseUrl: string | undefined,
): string {
  const baseUrl = flagBaseUrl ?? existing?.baseUrl;
  if (baseUrl === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      `profile "${profileName}" has no base URL yet; pass --base-url <deployment origin>`,
    );
  }
  if (!URL.canParse(baseUrl)) {
    throw new CliError(
      ExitCodes.USAGE,
      `--base-url expects a full URL, got "${baseUrl}"`,
    );
  }
  return baseUrl;
}

async function readPastedToken(
  deps: CliDeps,
  baseUrl: string,
): Promise<string> {
  const token = (await deps.readStdin()).trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new CliError(
      ExitCodes.USAGE,
      `that does not look like a MergeBrief token (expected the ${TOKEN_PREFIX} prefix); mint one at ${baseUrl}/settings`,
    );
  }
  if (!isSendableHeader("authorization", `Bearer ${token}`)) {
    throw new CliError(
      ExitCodes.USAGE,
      "that token holds a character HTTP refuses; paste it again on one line",
    );
  }
  return token;
}

export async function runAuthLogin(
  deps: CliDeps,
  global: GlobalOptions,
  options: { readonly baseUrl?: string },
): Promise<void> {
  const config = loadConfigOrRefuse(deps.configDir);
  const profileName = resolveLoginProfileName(deps, global, config);
  assertStorableProfileName(profileName);
  const existing = readHeldProfile(config, profileName);
  const baseUrl = readLoginBaseUrl(profileName, existing, options.baseUrl);
  const token = await readPastedToken(deps, baseUrl);

  const next = {
    defaultProfile: config.defaultProfile ?? profileName,
    profiles: {
      ...config.profiles,
      [profileName]: shapeLoginProfile(existing, baseUrl, token),
    },
  };
  saveConfig(deps.configDir, next);

  // The login output IS an auth status, no third synthesized shape.
  const savedProfile = next.profiles[profileName];
  if (savedProfile === undefined) {
    throw new Error("profile vanished after save"); // unreachable
  }
  // Verify the credential BEING INSTALLED: the env override must not mask a
  // bad paste, so it never applies to login's own verification.
  const resolved: ResolvedProfile = {
    name: profileName,
    profile: savedProfile,
    token,
    otherProfileNames: Object.keys(next.profiles).filter(
      (name) => name !== profileName,
    ),
  };
  const body = await buildAuthStatusBody(deps, resolved);
  emitStatus(deps, global.json, body, resolved.otherProfileNames);
}

export async function runAuthStatus(
  deps: CliDeps,
  global: GlobalOptions,
): Promise<void> {
  const resolved = resolveFromDisk(deps, global.profile);
  const body = await buildAuthStatusBody(deps, resolved);
  emitStatus(deps, global.json, body, resolved.otherProfileNames);
}

export async function runRepos(
  deps: CliDeps,
  global: GlobalOptions,
  options: { readonly refresh: boolean },
): Promise<void> {
  const resolved = resolveFromDisk(deps, global.profile);
  const cacheDeps: RepoCacheDeps = {
    client: createClient(deps, resolved),
    cacheDir: deps.cacheDir,
    profileName: resolved.name,
  };
  const { body, bodyText } = await loadRepos(cacheDeps, options);
  if (global.json) {
    // Passthrough: the server body VERBATIM, not one byte more (even an
    // appended newline is a byte the server never sent).
    deps.stdout(bodyText);
    return;
  }
  for (const repo of body.repos) {
    deps.stdout(`${repo.fullName}\t${repo.repoId}\n`);
  }
}
