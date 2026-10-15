import type { Command } from "commander";
import type { CommandContext } from "../../types";
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
