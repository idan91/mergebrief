import type { Command } from "commander";
import { CliError, ExitCodes } from "../../exit";
import type { CommandContext } from "../../types";
import { addSpanOptions, addRevisionOption } from "../options";
import { parseSpanFlags, runSpanRead } from "../span";
import type { SpanFlags } from "../span/types";
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
import { isTerminalColorEnabled } from "./terminal-diff";

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
  const groups = program
    .command("groups")
    .description("the PR's brief: change groups (default: the latest revision)")
    .argument("<number>", "PR number");
  addRevisionOption(groups).action(async (raw: string, options: SpanFlags) => {
    const prNumber = parsePrNumber(raw);
    const selection = parseSpanFlags(options);

    const target = await resolveRepoTarget(context);
    const { client, repoId, io } = target;
    await runSpanRead(target, prNumber, selection, async (span) => {
      await runGroups(client, repoId, prNumber, span, io);
      return undefined;
    });
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
  const diff = program
    .command("diff")
    .description("the PR's unified diff (its raw text IS the machine format)")
    .argument("<number>", "PR number")
    .option(
      "--group <id>",
      "filter to one change group's whole hunks (brief span only)",
    );
  addSpanOptions(diff).action(
    async (raw: string, options: SpanFlags & { group?: string }) => {
      if (context.readGlobals().json) {
        throw new CliError(
          ExitCodes.USAGE,
          "diff has no JSON arm; its raw output is the machine format",
        );
      }
      const prNumber = parsePrNumber(raw);
      requireDiffFlags(options);
      const selection = parseSpanFlags(options);

      const { deps } = context;
      const terminal = deps.stdoutIsTerminal
        ? { color: isTerminalColorEnabled(deps.env) }
        : undefined;

      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runSpanRead(target, prNumber, selection, async (span) => {
        await runDiff(
          client,
          repoId,
          prNumber,
          span,
          { group: options.group, pager: deps.pager, terminal },
          io,
        );
        return undefined;
      });
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
