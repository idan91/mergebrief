import type { Command } from "commander";
import { ReviewOutcomes } from "types";
import { CliError, ExitCodes } from "../exit";
import type { BriefSpan } from "../types";

export const REVIEW_OUTCOME_CHOICES = Object.values(ReviewOutcomes).join(" | ");

export const FULL_PAYLOAD_DESCRIPTION =
  'full JSON payload from a file, or "-" for stdin';
export const REQUIRED_PAYLOAD_DESCRIPTION =
  'JSON payload from a file, or "-" for stdin (required)';

/** `--base`/`--head`: the brief span a session command must name. */
export function addSpanOptions(command: Command): Command {
  return command
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)");
}

export function addPayloadOption(
  command: Command,
  description: string,
): Command {
  return command.option("-F, --payload <path>", description);
}

/** The flag form of a draft's anchor, shared by `draft create` and `reanchor`. */
export function addAnchorOptions(command: Command): Command {
  return command
    .option("--file <path>", "anchor file path (flag form)")
    .option("--side <side>", "old | new (flag form; default: new)")
    .option(
      "--start-side <side>",
      "old | new — side of --start when the range crosses sides (flag form)",
    )
    .option("--start <line>", "anchor start line (flag form)")
    .option("--end <line>", "anchor end line (flag form)");
}

/** The ONE client-side shape check; the server owns every other rule. */
export function requireSpan(
  base: string | undefined,
  head: string | undefined,
): BriefSpan {
  if (!base || !head) {
    throw new CliError(
      ExitCodes.USAGE,
      "--base and --head are required — name the brief span you reviewed (see `mergebrief pr <n>` baseSha/headSha); it is never auto-fetched",
    );
  }
  return { base, head };
}
