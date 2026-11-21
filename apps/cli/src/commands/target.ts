import { formatDisplayText } from "brief-core/hidden-chars";
import { CLI_VERSION, createApiClient, type ApiClient } from "../client";
import { CliError, ExitCodes } from "../exit";
import {
  fullNameFromOriginUrl,
  loadConfigOrRefuse,
  ownerFromOriginUrl,
  resolveProfile,
  resolveStoredProfile,
  type ResolvedProfile,
  type ResolveProfileInput,
  type StoredProfile,
} from "../profile/config";
import type { ProfileCache } from "../profile/read-revisions";
import { resolveRepoId } from "../profile/repos";
import { recordServerVersion } from "../version";
import type {
  CliDeps,
  CommandContext,
  CommandIo,
  GlobalOptions,
} from "../types";

const REPO_FULL_NAME = /^[^/\s]+\/[^/\s]+$/;

export interface ProfileTarget {
  readonly client: ApiClient;
  readonly io: CommandIo;
}

export interface RepoTarget extends ProfileTarget {
  readonly repoId: string;
  readonly cache: ProfileCache;
}

export function resolveCliVersion(deps: CliDeps): string {
  return deps.cliVersion ?? CLI_VERSION;
}

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

/**
 * A warning, never a refusal: a private network is the operator's call. A
 * success-only line, since a failed run owes its reader one stderr line.
 */
function warnOnPlainHttp(deps: CliDeps, resolved: ResolvedProfile): void {
  const url = new URL(resolved.profile.baseUrl);
  const leavesTheHost =
    url.protocol === "http:" && !LOOPBACK_HOSTS.includes(url.hostname);
  if (leavesTheHost && resolved.token !== undefined) {
    const notify = deps.successNotice ?? deps.stderr;
    notify(
      `warning: profile ${formatDisplayText(resolved.name)} sends its token over plain http to ${url.hostname}`,
    );
  }
}

export function createClient(
  deps: CliDeps,
  resolved: ResolvedProfile,
): ApiClient {
  warnOnPlainHttp(deps, resolved);
  return createApiClient({
    fetch: deps.fetch,
    baseUrl: resolved.profile.baseUrl,
    token: resolved.token,
    headers: resolved.profile.headers,
    profileName: resolved.name,
    otherProfileNames: resolved.otherProfileNames,
    cliVersion: resolveCliVersion(deps),
    onServerVersion: (version) => recordServerVersion(deps, version),
  });
}

export function readGitRemoteOwner(deps: CliDeps): string | undefined {
  const originUrl = deps.gitOriginUrl();
  return originUrl === undefined ? undefined : ownerFromOriginUrl(originUrl);
}

function readResolveInput(
  deps: CliDeps,
  flagProfile: string | undefined,
): ResolveProfileInput {
  return {
    config: loadConfigOrRefuse(deps.configDir),
    env: deps.env,
    flagProfile,
    gitRemoteOwner: readGitRemoteOwner(deps),
  };
}

export function resolveFromDisk(
  deps: CliDeps,
  flagProfile: string | undefined,
): ResolvedProfile {
  return resolveProfile(readResolveInput(deps, flagProfile));
}

/** For a command that sends no token, so the env token's route never refuses it. */
export function resolveStoredFromDisk(
  deps: CliDeps,
  flagProfile: string | undefined,
): StoredProfile {
  return resolveStoredProfile(readResolveInput(deps, flagProfile));
}

export function readIo(deps: CliDeps, global: GlobalOptions): CommandIo {
  return {
    stdout: deps.stdout,
    stderr: deps.stderr,
    successNotice: deps.successNotice ?? deps.stderr,
    json: global.json,
  };
}

/** A bare number names a PR in the target repository; anything else is a URL. */
export function isPrNumberArgument(raw: string): boolean {
  return /^\d+$/.test(raw);
}

export function parsePrNumber(raw: string): number {
  if (!isPrNumberArgument(raw)) {
    throw new CliError(
      ExitCodes.USAGE,
      `PR number must be a positive integer, got "${raw}"`,
    );
  }
  return Number(raw);
}

/** The resolved profile's client, for commands that address no repository. */
export function resolveProfileTarget(context: CommandContext): ProfileTarget {
  const global = context.readGlobals();
  const resolved = resolveFromDisk(context.deps, global.profile);
  return {
    client: createClient(context.deps, resolved),
    io: readIo(context.deps, global),
  };
}

/** The target repository: `-R` beats the origin remote; no prompts, ever.
 * May reach the network, so a caller validates its local input first. */
export async function resolveRepoTarget(
  context: CommandContext,
): Promise<RepoTarget> {
  const { deps } = context;
  const global = context.readGlobals();
  const resolved = resolveFromDisk(deps, global.profile);
  const originUrl = deps.gitOriginUrl();
  const fullName =
    global.repo ??
    (originUrl === undefined ? undefined : fullNameFromOriginUrl(originUrl));
  if (fullName === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "no target repository: run inside a git repo with an origin remote, or pass -R owner/name",
    );
  }
  if (!REPO_FULL_NAME.test(fullName)) {
    throw new CliError(
      ExitCodes.USAGE,
      `-R expects owner/name, got "${fullName}"`,
    );
  }

  const client = createClient(deps, resolved);
  const repoId = await resolveRepoId(
    {
      client,
      cacheDir: deps.cacheDir,
      profileName: resolved.name,
      otherProfileNames: resolved.otherProfileNames,
    },
    fullName,
  );
  return {
    client,
    repoId,
    io: readIo(deps, global),
    cache: { cacheDir: deps.cacheDir, profileName: resolved.name },
  };
}
