import type { Command } from "commander";
import type { CommandContext } from "../../types";
import { runAuthOwners, runAuthProfiles, runAuthUse } from "./profiles";
import { runAuthLogin, runAuthStatus, runRepos } from "./run";

export function registerAuthCommands(
  program: Command,
  context: CommandContext,
): void {
  const auth = program
    .command("auth")
    .description("authentication against your deployment");
  auth
    .command("login")
    .description("store a token for a profile (paste it, or pipe it on stdin)")
    .option(
      "--base-url <url>",
      "deployment origin, e.g. https://mergebrief.example.com",
    )
    .action(async (options: { baseUrl?: string }) =>
      runAuthLogin(context.deps, context.readGlobals(), options),
    );
  auth
    .command("status")
    .description("config + server status for the resolved profile")
    .action(async () => runAuthStatus(context.deps, context.readGlobals()));
  auth
    .command("profiles")
    .description("every profile in the config, tokens and headers left out")
    .action(() => {
      runAuthProfiles(context.deps, context.readGlobals());
    });
  auth
    .command("use")
    .description("set the default profile")
    .argument("<name>", "a profile `auth profiles` lists")
    .action((name: string) => {
      runAuthUse(context.deps, context.readGlobals(), name);
    });
  auth
    .command("owners")
    .description(
      "set the GitHub owners the resolved profile serves, replacing its list",
    )
    .argument("[owner...]", "owner slugs whose clones route to this profile")
    .option("--clear", "remove every owner from the profile", false)
    .action((owners: string[], options: { clear: boolean }) => {
      runAuthOwners(context.deps, context.readGlobals(), owners, options);
    });
}

export function registerReposCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("repos")
    .description(
      "repositories visible to the profile's token (cached; see --refresh)",
    )
    .option("--refresh", "bypass the disk cache", false)
    .action(async (options: { refresh: boolean }) =>
      runRepos(context.deps, context.readGlobals(), options),
    );
}
