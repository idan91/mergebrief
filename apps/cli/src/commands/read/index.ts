import type { Command } from "commander";
import { CliError, ExitCodes } from "../../exit";
import type { CommandContext } from "../../types";
import {
  parsePrNumber,
  resolveProfileTarget,
  resolveRepoTarget,
} from "../target";
import { runGenerationClaims } from "./generation";
import {
  requireDeltaFlags,
  requireDiffFlags,
  runCollaborators,
  runConversation,
  runDelta,
  runDiff,
  runGroups,
  runPrList,
  runPrMeta,
} from "./run";

export function registerPrCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("pr")
    .description("your PRs (no argument), or one PR's metadata")
    .argument("[number]", "PR number in the target repository")
    .action(async (raw: string | undefined) => {
      if (raw === undefined) {
        const { client, io } = resolveProfileTarget(context);
        await runPrList(client, io);
        return;
      }

      const prNumber = parsePrNumber(raw);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runPrMeta(client, repoId, prNumber, io);
    });
}

export function registerGenerationCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("generation")
    .description(
      "the PR head's generation claims, last failure and takeover job",
    )
    .argument("<number>", "PR number")
    .action(async (raw: string) => {
      const prNumber = parsePrNumber(raw);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runGenerationClaims(client, repoId, prNumber, io);
    });
}

export function registerGroupsCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("groups")
    .description("the PR's brief: change groups over the current span")
    .argument("<number>", "PR number")
    .action(async (raw: string) => {
      const prNumber = parsePrNumber(raw);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runGroups(client, repoId, prNumber, io);
    });
}

export function registerConversationCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("conversation")
    .description("the PR's review conversation")
    .argument("<number>", "PR number")
    .action(async (raw: string) => {
      const prNumber = parsePrNumber(raw);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runConversation(client, repoId, prNumber, io);
    });
}

export function registerDiffCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("diff")
    .description("the PR's unified diff (its raw text IS the machine format)")
    .argument("<number>", "PR number")
    .option("--base <sha>", "span base (with --head)")
    .option("--head <sha>", "span head (with --base)")
    .option(
      "--group <id>",
      "filter to one change group's whole hunks (brief span only)",
    )
    .action(
      async (
        raw: string,
        options: { base?: string; head?: string; group?: string },
      ) => {
        if (context.readGlobals().json) {
          throw new CliError(
            ExitCodes.USAGE,
            "diff has no JSON arm; its raw output is the machine format",
          );
        }
        const prNumber = parsePrNumber(raw);
        requireDiffFlags(options);

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runDiff(
          client,
          repoId,
          prNumber,
          { ...options, pager: context.deps.pager },
          io,
        );
      },
    );
}

export function registerCollaboratorsCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("collaborators")
    .description("the target repo's collaborator roster (push access required)")
    .action(async () => {
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runCollaborators(client, repoId, io);
    });
}

export function registerDeltaCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("delta")
    .description("what changed since your last review (union: available | not)")
    .argument("<number>", "PR number")
    .option(
      "--baseline <sha>",
      "override the checkpoint baseline (with --head)",
    )
    .option("--head <sha>", "override the head (with --baseline)")
    .action(
      async (raw: string, options: { baseline?: string; head?: string }) => {
        const prNumber = parsePrNumber(raw);
        requireDeltaFlags(options);

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runDelta(client, repoId, prNumber, options, io);
      },
    );
}
