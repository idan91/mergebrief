import type { Command } from "commander";
import type { CommandContext } from "../../types";
import { resolveProfileTarget } from "../target";
import { runSpend } from "./run";

export function registerSpendCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("spend")
    .description("today's started runs against the daily cap (Operators only)")
    .action(async () => {
      const { client, io } = resolveProfileTarget(context);
      await runSpend(client, io);
    });
}
