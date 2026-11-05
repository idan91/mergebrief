import type { Command } from "commander";
import { ChangeGroupCategories, ReviewOutcomes } from "types";

export const REVIEW_OUTCOME_CHOICES = Object.values(ReviewOutcomes).join(" | ");

/** Help text only: the server validates, so an older CLI never refuses a newer value. */
export const CATEGORY_CHOICES = Object.values(ChangeGroupCategories).join(
  " | ",
);

export const FULL_PAYLOAD_DESCRIPTION =
  'full JSON payload from a file, or "-" for stdin';
export const REQUIRED_PAYLOAD_DESCRIPTION =
  'JSON payload from a file, or "-" for stdin (required)';

/** `--revision`: a brief by the number the web's `?rev=` also uses. */
export function addRevisionOption(command: Command): Command {
  return command.option(
    "--revision <n>",
    "a brief revision by number (`pr <n> --json` lists them)",
  );
}

/** The flags that name a brief; with none, `commands/span` chooses one. */
export function addSpanOptions(command: Command): Command {
  return addRevisionOption(command)
    .option("--base <sha>", "span base (with --head)")
    .option("--head <sha>", "span head (with --base)");
}

export function addPayloadOption(
  command: Command,
  description: string,
): Command {
  return command.option("-F, --payload <path>", description);
}

export function addPayloadExample(command: Command, example: unknown): void {
  command.addHelpText(
    "after",
    `\nExample payload:\n  ${JSON.stringify(example)}`,
  );
}

/** The flag form of a draft's anchor, shared by `draft create` and `reanchor`. */
export function addAnchorOptions(command: Command): Command {
  return command
    .option("--file <path>", "anchor file path (flag form)")
    .option("--side <side>", "old | new (flag form; default: new)")
    .option(
      "--start-side <side>",
      "old | new: side of --start when the range crosses sides (flag form)",
    )
    .option("--start <line>", "anchor start line (flag form)")
    .option("--end <line>", "anchor end line (flag form)");
}
