import { CliError, ExitCodes } from "../../exit";
import {
  findOwnerProfileName,
  loadConfigOrRefuse,
  readDefaultProfileName,
  readHeldProfile,
  saveConfig,
  type CliConfig,
} from "../../profile/config";
import type { CliDeps, GlobalOptions } from "../../types";
import { resolveFromDisk } from "../target";
import { GITHUB_OWNER_SLUG } from "./consts";
import type { AuthProfilesBody, ProfileSummary } from "./types";

function shapeProfileSummaries(config: CliConfig): ProfileSummary[] {
  const defaultName = readDefaultProfileName(config);
  return Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    baseUrl: profile.baseUrl,
    owners: profile.owners ?? [],
    isDefault: name === defaultName,
    tokenConfigured: profile.token !== undefined,
  }));
}

/** TTY rendering, explicitly NON-contractual. */
function describeProfileSummary(summary: ProfileSummary): string {
  const marker = summary.isDefault ? "*" : " ";
  const owners = summary.owners.join(",");
  const token = summary.tokenConfigured ? "token" : "no token";
  return `${marker} ${summary.name}\t${summary.baseUrl}\t${token}\t${owners}\n`;
}

export function runAuthProfiles(deps: CliDeps, global: GlobalOptions): void {
  const profiles = shapeProfileSummaries(loadConfigOrRefuse(deps.configDir));
  if (global.json) {
    const body: AuthProfilesBody = { profiles };
    deps.stdout(`${JSON.stringify(body)}\n`);
    return;
  }
  for (const summary of profiles) {
    deps.stdout(describeProfileSummary(summary));
  }
}

export function runAuthUse(
  deps: CliDeps,
  global: GlobalOptions,
  name: string,
): void {
  const config = loadConfigOrRefuse(deps.configDir);
  if (readHeldProfile(config, name) === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      `profile "${name}" is not configured (run: mergebrief auth login --profile ${name})`,
    );
  }

  saveConfig(deps.configDir, { ...config, defaultProfile: name });
  if (!global.json) {
    deps.stdout(`default profile → ${name}\n`);
  }
}

function assertOwnersFree(
  config: CliConfig,
  owners: readonly string[],
  profileName: string,
): void {
  for (const owner of owners) {
    const holder = findOwnerProfileName(config, owner);
    if (holder !== undefined && holder !== profileName) {
      throw new CliError(
        ExitCodes.USAGE,
        `owner "${owner}" already routes to "${holder}"; change that profile first`,
      );
    }
  }
}

export function runAuthOwners(
  deps: CliDeps,
  global: GlobalOptions,
  owners: readonly string[],
  options: { readonly clear: boolean },
): void {
  const namesOwners = owners.length > 0;
  if (namesOwners === options.clear) {
    throw new CliError(
      ExitCodes.USAGE,
      "name the owners this profile serves, or pass --clear, not both",
    );
  }
  const malformed = owners.find((owner) => !GITHUB_OWNER_SLUG.test(owner));
  if (malformed !== undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      `"${malformed}" is not a GitHub owner, so no clone would match it; pass each owner as its own argument`,
    );
  }

  const config = loadConfigOrRefuse(deps.configDir);
  const { name, profile } = resolveFromDisk(deps, global.profile);
  assertOwnersFree(config, owners, name);

  saveConfig(deps.configDir, {
    ...config,
    profiles: {
      ...config.profiles,
      [name]: { ...profile, owners: [...owners] },
    },
  });
  if (!global.json) {
    deps.stdout(`profile ${name} owners → ${owners.join(",")}\n`);
  }
}
