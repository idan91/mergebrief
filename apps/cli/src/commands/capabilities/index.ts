import type { Command } from "commander";
import operationsMap from "../../../product-operations.map.json";
import type { CommandContext } from "../../types";
import { resolveCliVersion, resolveProfileTarget } from "../target";
import { runCapabilities } from "./run";

export function registerCapabilitiesCommand(
  program: Command,
  context: CommandContext,
): void {
  program
    .command("capabilities")
    .description(
      "what this server+CLI pair can run; --require makes it a fail-closed check",
    )
    .option(
      "--require <ids...>",
      "operation ids that must be runnable here (any failure → exit 6)",
    )
    .action(async (options: { require?: string[] }) => {
      const { client, io } = resolveProfileTarget(context);
      await runCapabilities({
        client,
        cliVersion: resolveCliVersion(context.deps),
        operationsMapRaw: operationsMap,
        requireIds: options.require ?? [],
        io,
      });
    });
}
