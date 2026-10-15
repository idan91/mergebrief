import type { Command } from "commander";
import type { CommandContext } from "../../types";
import { addSpanOptions, requireSpan } from "../options";
import { parsePrNumber, resolveRepoTarget } from "../target";
import {
  requireComparisonSpan,
  requireNarrativeSpan,
  runContext,
  runMarks,
  runNarrative,
  runSession,
} from "./run";

export function registerSessionCommand(
  program: Command,
  context: CommandContext,
): void {
  const session = program
    .command("session")
    .description("your review session on the brief span you name")
    .argument("<number>", "PR number");
  addSpanOptions(session).action(
    async (raw: string, options: { base?: string; head?: string }) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSession(client, repoId, prNumber, span, io);
    },
  );
}

export function registerMarksCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("marks")
    .description(
      "comparison marks (coordinates only) for a baseline..head span",
    )
    .argument("<number>", "PR number")
    .option("--baseline <sha>", "comparison baseline (required)")
    .option("--head <sha>", "comparison head (required)")
    .action(
      async (raw: string, options: { baseline?: string; head?: string }) => {
        const prNumber = parsePrNumber(raw);
        const span = requireComparisonSpan(options.baseline, options.head);

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runMarks(client, repoId, prNumber, span, io);
      },
    );
}

export function registerNarrativeCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("narrative")
    .description("the revision narrative for a prevHead..head hop")
    .argument("<number>", "PR number")
    .option("--prev-head <sha>", "prior briefed head (required)")
    .option("--head <sha>", "revision head (required)")
    .action(
      async (raw: string, options: { prevHead?: string; head?: string }) => {
        const prNumber = parsePrNumber(raw);
        const span = requireNarrativeSpan(options.prevHead, options.head);

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runNarrative(client, repoId, prNumber, span, io);
      },
    );
}

export function registerContextCommand(
  program: Command,
  context: CommandContext,
): void {
  const contextCommand = program
    .command("context")
    .description("the brief's repo-config snapshot for the span you name")
    .argument("<number>", "PR number");
  addSpanOptions(contextCommand).action(
    async (raw: string, options: { base?: string; head?: string }) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runContext(client, repoId, prNumber, span, io);
    },
  );
}
