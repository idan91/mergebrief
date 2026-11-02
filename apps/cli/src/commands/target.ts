import { CLI_VERSION, createApiClient, type ApiClient } from "../client";
import { CliError, ExitCodes } from "../exit";
import {
  fullNameFromOriginUrl,
  loadConfig,
  ownerFromOriginUrl,
  resolveProfile,
  type ResolvedProfile,
} from "../profile/config";
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
}

export function resolveCliVersion(deps: CliDeps): string {
  return deps.cliVersion ?? CLI_VERSION;
}

export function createClient(
  deps: CliDeps,
  resolved: ResolvedProfile,
): ApiClient {
  return createApiClient({
    fetch: deps.fetch,
    baseUrl: resolved.profile.baseUrl,
    token: resolved.token,
    headers: resolved.profile.headers,
    cliVersion: resolveCliVersion(deps),
    onServerVersion: (version) => recordServerVersion(deps, version),
  });
}

export function resolveFromDisk(
  deps: CliDeps,
  flagProfile: string | undefined,
): ResolvedProfile {
  const config = loadConfig(deps.configDir);
  if (!config.ok) {
    throw new CliError(ExitCodes.USAGE, config.error);
  }
  const originUrl = deps.gitOriginUrl();
  return resolveProfile({
    config: config.value,
    env: deps.env,
    flagProfile,
    gitRemoteOwner:
      originUrl === undefined ? undefined : ownerFromOriginUrl(originUrl),
  });
}

export function readIo(deps: CliDeps, global: GlobalOptions): CommandIo {
  return {
    stdout: deps.stdout,
    stderr: deps.stderr,
    successNotice: deps.successNotice ?? deps.stderr,
    json: global.json,
  };
}

export function parsePrNumber(raw: string): number {
  if (!/^\d+$/.test(raw)) {
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
    { client, cacheDir: deps.cacheDir, profileName: resolved.name },
    fullName,
  );
  return { client, repoId, io: readIo(deps, global) };
}
