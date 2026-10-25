import type { Mutable } from "types";
import type { ApiClient } from "../../client";
import { CliError, ExitCodes } from "../../exit";
import {
  loadConfig,
  saveConfig,
  type ResolvedProfile,
} from "../../profile/config";
import { loadRepos, type RepoCacheDeps } from "../../profile/repos";
import type { CliDeps, GlobalOptions } from "../../types";
import { isRecord } from "../../utils";
import { formatSemver, parseSemver } from "../../version";
import { createClient, resolveCliVersion, resolveFromDisk } from "../target";
import {
  DELETE_CODE,
  LAST_C0_CODE,
  LAST_C1_CODE,
  RELEASE_FLAG_FIELDS,
  RELEASE_STRING_FIELDS,
  TOKEN_PREFIX,
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

/** Probe the server (version + auth in one gated read); never throws. */
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

function emitStatus(deps: CliDeps, json: boolean, body: AuthStatusBody): void {
  if (json) {
    deps.stdout(`${JSON.stringify(body)}\n`);
    return;
  }
  // TTY rendering, explicitly NON-contractual.
  const auth = describeAuthState(body.server.authenticated);
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

export async function runAuthLogin(
  deps: CliDeps,
  global: GlobalOptions,
  options: { readonly baseUrl?: string },
): Promise<void> {
  const config = loadConfig(deps.configDir);
  if (!config.ok) {
    throw new CliError(ExitCodes.USAGE, config.error);
  }
  // MERGEBRIEF_PROFILE selects the login target exactly like --profile.
  const profileName =
    global.profile ?? deps.env["MERGEBRIEF_PROFILE"] ?? "default";
  const existing = config.value.profiles[profileName];
  const baseUrl = options.baseUrl ?? existing?.baseUrl;
  if (baseUrl === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      `profile "${profileName}" has no base URL yet; pass --base-url <deployment origin>`,
    );
  }

  const token = (await deps.readStdin()).trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new CliError(
      ExitCodes.USAGE,
      `that does not look like a MergeBrief token (expected the ${TOKEN_PREFIX} prefix); mint one at ${baseUrl}/settings`,
    );
  }

  const next = {
    defaultProfile: config.value.defaultProfile ?? profileName,
    profiles: {
      ...config.value.profiles,
      [profileName]: { ...existing, baseUrl, token },
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
  };
  emitStatus(deps, global.json, await buildAuthStatusBody(deps, resolved));
}

export async function runAuthStatus(
  deps: CliDeps,
  global: GlobalOptions,
): Promise<void> {
  const resolved = resolveFromDisk(deps, global.profile);
  emitStatus(deps, global.json, await buildAuthStatusBody(deps, resolved));
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
